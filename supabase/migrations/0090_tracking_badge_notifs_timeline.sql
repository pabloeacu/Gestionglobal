-- ============================================================================
-- Migration: 0090_tracking_badge_notifs_timeline
-- Fecha: 2026-05-27
-- DGG-XX · 3 features adicionales del bloque de tracking (post 0089):
--
--   A) Badge "Nuevo avance" en dashboard portal cliente.
--      Cuando se crea una línea con visible_cliente=true, además de email+push
--      ahora también emite notif_interna al user_id del admin → eso permite
--      contar "no leídas" para el badge. Se agrega campo
--      `tracking_avances_nuevos` al snapshot del dashboard.
--
--   B) Notif in-app al operador asignado cuando un cliente (no staff) agrega
--      línea a un tracking — equivalente a "subir archivos vía acceso externo".
--      Trigger detecta autor con role IN ('administrador') y avisa al
--      asignado_a del tramite (o broadcast a staff si no hay asignado).
--
--   C) Widget "Próximos seguimientos" en dashboard gerencia.
--      RPC `gerencia_proximos_seguimientos(p_dias int)` devuelve líneas con
--      alerta_en próxima (ordenadas asc) para listar en el widget.
--
-- Regla 6 (migración versionada), 12 (tenancy guard en RPCs alcanzables por
-- admin), 13 (no se usan window.confirm — esto es DB only).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A+B) Reescribir trigger tracking_linea_on_insert (extensión del 0089)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite           record;
  v_servicio_nombre   text;
  v_to_email          text;
  v_to_nombre         text;
  v_admin_user_id     uuid;
  v_portal_url        text;
  v_gerencia_url      text;
  v_autor_role        text;
  v_autor_admin_id    uuid;
  v_asignado_a        uuid;
  v_archivos_count    int;
BEGIN
  UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = NEW.tramite_id;

  -- Detectar role del autor (para CAMINO C)
  IF NEW.autor_id IS NOT NULL THEN
    SELECT role, administracion_id INTO v_autor_role, v_autor_admin_id
      FROM public.profiles WHERE id = NEW.autor_id;
  END IF;

  v_archivos_count := COALESCE(array_length(NEW.archivos_urls, 1), 0);

  -- Si ningún camino aplica, salir rápido
  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now())
     AND NEW.visible_cliente = false
     AND NOT (v_autor_role = 'administrador') THEN
    RETURN NEW;
  END IF;

  -- Cargar info común
  SELECT t.*, s.nombre AS svc_nombre
    INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = NEW.tramite_id;

  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_asignado_a := v_tramite.asignado_a;

  v_to_email := v_tramite.solicitante_email;
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  v_portal_url   := 'https://www.gestionglobal.ar/portal/mis-gestiones/' || NEW.tramite_id::text;
  v_gerencia_url := 'https://www.gestionglobal.ar/gestion/tracking/' || NEW.tramite_id::text;

  -- CAMINO A: alerta futura → recordatorio
  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'tracking-recordatorio', v_to_email, v_to_nombre,
      jsonb_build_object(
        'tipo', v_servicio_nombre,
        'descripcion', NEW.descripcion,
        'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
      ),
      v_tramite.administracion_id, v_tramite.consorcio_id,
      'tracking_lineas', NEW.id, 5::smallint
    );
  END IF;

  -- CAMINO B: visible al cliente → email + push + notif_interna
  IF NEW.visible_cliente = true THEN
    IF v_to_email IS NOT NULL THEN
      PERFORM public.encolar_email(
        'tracking-avance-cliente', v_to_email, v_to_nombre,
        jsonb_build_object(
          'destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_servicio_nombre,
          'descripcion', NEW.descripcion,
          'portal_url', v_portal_url
        ),
        v_tramite.administracion_id, v_tramite.consorcio_id,
        'tracking_lineas', NEW.id, 3::smallint
      );
    END IF;

    IF v_admin_user_id IS NOT NULL THEN
      -- Push web (transient)
      PERFORM public.encolar_push(
        v_admin_user_id,
        'Nuevo avance: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 140),
        NULL,
        v_portal_url
      );

      -- Notif in-app (persistent → permite contar no leídas para badge)
      PERFORM private.notif_emitir(
        v_admin_user_id,
        'tracking_avance',
        'Nuevo avance: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 200),
        '/portal/mis-gestiones/' || NEW.tramite_id::text,
        jsonb_build_object(
          'tramite_id', NEW.tramite_id,
          'linea_id', NEW.id,
          'servicio', v_servicio_nombre
        )
      );
    END IF;
  END IF;

  -- CAMINO C: cliente (admin) sube línea → notif al operador (staff)
  -- Detecta: autor con role='administrador' (no staff). Si tiene asignado_a
  -- → notif a ese user. Si no, broadcast a todos los staff.
  IF v_autor_role = 'administrador' THEN
    DECLARE
      v_titulo text := CASE
        WHEN v_archivos_count > 0 THEN 'Cliente subió archivos: ' || v_servicio_nombre
        ELSE 'Cliente agregó nota: ' || v_servicio_nombre
      END;
      v_cuerpo text := COALESCE(NULLIF(v_to_nombre, ''), 'El administrador')
        || ' · ' || substring(NEW.descripcion, 1, 160)
        || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END;
      v_url text := '/gestion/tracking/' || NEW.tramite_id::text;
      v_payload jsonb := jsonb_build_object(
        'tramite_id', NEW.tramite_id,
        'linea_id', NEW.id,
        'administracion_id', v_autor_admin_id,
        'archivos_count', v_archivos_count
      );
    BEGIN
      IF v_asignado_a IS NOT NULL THEN
        PERFORM private.notif_emitir(v_asignado_a, 'tracking_cliente_movimiento',
          v_titulo, v_cuerpo, v_url, v_payload);
      ELSE
        PERFORM private.notif_emitir_staff('tracking_cliente_movimiento',
          v_titulo, v_cuerpo, v_url, v_payload);
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_linea_on_insert() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tracking_linea_on_insert IS
  'Trigger AFTER INSERT en tracking_lineas. 3 caminos: A) alerta futura→email recordatorio. B) visible_cliente→email+push+notif al cliente. C) autor=admin→notif al operador asignado (cliente movió algo).';


-- ---------------------------------------------------------------------------
-- A) Extender cliente_portal_dashboard: contar avances no leídos
--    (modificación quirúrgica usando ALTER + view? No — la RPC se reescribe
--    en su versión completa. Para evitar duplicar la migración entera del
--    dashboard, agregamos un wrapper que llama la original y agrega el campo)
--
-- Decisión: agregamos un parámetro post-procesado. La función original
-- cliente_portal_dashboard() no se modifica acá — en su lugar el FRONTEND
-- llamará tanto al dashboard como a la cuenta de tracking_avances_nuevos
-- por separado. Más simple y desacopla.
--
-- Solo definimos la RPC contador:
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_tracking_avances_nuevos_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COUNT(*)::int
  FROM public.notificaciones_internas
  WHERE user_id = auth.uid()
    AND tipo = 'tracking_avance'
    AND leido_at IS NULL
    AND archivado_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_tracking_avances_nuevos_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_tracking_avances_nuevos_count() TO authenticated;

COMMENT ON FUNCTION public.cliente_tracking_avances_nuevos_count IS
  'Devuelve cuántas notif_internas tipo tracking_avance sin leer tiene el user actual (badge "Mis gestiones").';


-- ---------------------------------------------------------------------------
-- C) RPC gerencia_proximos_seguimientos para widget timeline
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerencia_proximos_seguimientos(p_dias integer DEFAULT 7)
RETURNS TABLE (
  linea_id        uuid,
  tramite_id      uuid,
  tramite_titulo  text,
  tramite_codigo  text,
  alerta_en       timestamptz,
  dias_restantes  int,
  categoria       text,
  descripcion     text,
  administracion_nombre text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    tl.id                   AS linea_id,
    tl.tramite_id           AS tramite_id,
    COALESCE(t.titulo, s.nombre, 'Trámite') AS tramite_titulo,
    t.codigo                AS tramite_codigo,
    tl.alerta_en            AS alerta_en,
    EXTRACT(DAY FROM (tl.alerta_en - now()))::int AS dias_restantes,
    tl.categoria            AS categoria,
    tl.descripcion          AS descripcion,
    COALESCE(a.nombre, '—') AS administracion_nombre
  FROM public.tracking_lineas tl
  JOIN public.tramites t        ON t.id = tl.tramite_id
  LEFT JOIN public.servicios s  ON s.id = t.servicio_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE tl.alerta_en IS NOT NULL
    AND tl.alerta_en >  now()
    AND tl.alerta_en <= now() + make_interval(days => GREATEST(p_dias, 1))
    AND t.estado NOT IN ('cerrado','cancelado')
    AND private.is_staff()
  ORDER BY tl.alerta_en ASC
  LIMIT 30;
$$;

REVOKE EXECUTE ON FUNCTION public.gerencia_proximos_seguimientos(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerencia_proximos_seguimientos(integer) TO authenticated;

COMMENT ON FUNCTION public.gerencia_proximos_seguimientos IS
  'Líneas de tracking con alerta_en en los próximos N días (default 7). Solo staff. Widget timeline dashboard gerencia.';


-- ---------------------------------------------------------------------------
-- A) Helper: marcar como leídas las notif tracking_avance de un tramite
--    Cuando el cliente abre la vista de detalle del tramite, marca leídas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_marcar_tracking_leido(p_tramite_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.notificaciones_internas
     SET leido_at = now()
   WHERE user_id = auth.uid()
     AND tipo = 'tracking_avance'
     AND leido_at IS NULL
     AND (payload->>'tramite_id')::uuid = p_tramite_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_marcar_tracking_leido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_marcar_tracking_leido(uuid) TO authenticated;
