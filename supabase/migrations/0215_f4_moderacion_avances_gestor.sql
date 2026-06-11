-- 0215 · F4 (Lista JL · DGG-66) · Moderación de aportes del gestor
--
-- Cambio de paradigma (José Luis): hoy el aporte del gestor externo
-- (gestor_cargar_avance) inserta una tracking_lineas con visible_cliente=true →
-- el trigger notifica al cliente AL INSTANTE (se publica directo). A partir de
-- ahora el aporte entra como PENDIENTE DE REVISIÓN (no visible al cliente, no lo
-- notifica) y la gerencia decide: (a) publicar tal cual, (b) editar texto/
-- adjuntos y publicar, (c) publicar + cambiar estado, (d) dejarlo interno
-- (registro gerencia-only, no visible), (e) descartar (no publica; queda como
-- auditoría con motivo). Recién al PUBLICAR se notifica al cliente.
--
-- Decisiones de Pablo (DGG-66): moderación en AMBAS superficies (bandeja + inline
-- en el detalle); al gestor sólo se le avisa "recibido, en revisión" (no el
-- resultado); editar PRESERVA el texto original del gestor (auditoría); descartar
-- es soft (no borra la fila, queda con moderacion_estado='descartado').

-- ---------------------------------------------------------------------------
-- 1 · Columnas de moderación en tracking_lineas (aditivo; sólo aplican a las
--     líneas categoria='gestor_avance').
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracking_lineas
  ADD COLUMN IF NOT EXISTS moderacion_estado text,            -- NULL = no moderable; gestor_avance: pendiente|publicado|interno|descartado
  ADD COLUMN IF NOT EXISTS gestor_descripcion_original text,  -- lo que escribió el gestor (inmutable, auditoría)
  ADD COLUMN IF NOT EXISTS gestor_label text,                 -- nombre/identidad del gestor que aportó
  ADD COLUMN IF NOT EXISTS moderada_at timestamptz,
  ADD COLUMN IF NOT EXISTS moderada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descarte_motivo text;

COMMENT ON COLUMN public.tracking_lineas.moderacion_estado IS
  'F4 (DGG-66): sólo gestor_avance. pendiente=esperando revisión de gerencia (no visible al cliente); publicado=aprobado y visible; interno=registro gerencia-only; descartado=rechazado (auditoría, no visible).';

CREATE INDEX IF NOT EXISTS idx_tracking_lineas_moderacion
  ON public.tracking_lineas (created_at DESC)
  WHERE categoria = 'gestor_avance' AND moderacion_estado = 'pendiente';

-- ---------------------------------------------------------------------------
-- 2 · Helper: notificar al cliente un avance ya visible (extraído del trigger
--     para reusarlo desde la RPC de moderación al PUBLICAR — sin drift).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tracking_notificar_avance_cliente(p_linea_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea   public.tracking_lineas%ROWTYPE;
  v_tramite record;
  v_svc     text;
  v_to_email text;
  v_to_nombre text;
  v_admin_user_id uuid;
  v_portal_url text;
BEGIN
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN RETURN; END IF;

  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = v_linea.tramite_id;
  v_svc := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
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
  v_portal_url := 'https://www.gestionglobal.ar/portal/mis-gestiones/' || v_linea.tramite_id::text;

  IF v_to_email IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_email(
        'tracking-avance-cliente', v_to_email, v_to_nombre,
        jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_svc, 'descripcion', v_linea.descripcion, 'portal_url', v_portal_url),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', v_linea.id, 3::smallint
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_admin_user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_svc,
        substring(v_linea.descripcion, 1, 140), NULL, v_portal_url);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance',
        'Nuevo avance: ' || v_svc, substring(v_linea.descripcion, 1, 200),
        '/portal/mis-gestiones/' || v_linea.tramite_id::text,
        jsonb_build_object('tramite_id', v_linea.tramite_id, 'linea_id', v_linea.id, 'servicio', v_svc));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION private.tracking_notificar_avance_cliente(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · gestor_cargar_avance: el aporte entra PENDIENTE (no visible, no notifica
--     al cliente). Guarda el texto original + label del gestor para la cola.
--     Misma firma → CREATE OR REPLACE (R16).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gestor_cargar_avance(p_token text, p_descripcion text, p_archivos_urls text[] DEFAULT '{}'::text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_label text;
  v_raw   text;
  v_linea_id uuid;
BEGIN
  IF COALESCE(trim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM public.accesos_externos
   WHERE public.accesos_externos.token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002';
  END IF;
  IF v_acc.revocado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501';
  END IF;
  IF v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo <> 'solicitud' THEN
    RAISE EXCEPTION 'Token no corresponde a una solicitud' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes s WHERE s.id = v_acc.recurso_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.tramite_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado' USING ERRCODE = '22023';
  END IF;

  v_label := COALESCE(NULLIF(v_acc.nombre_destinatario, ''), v_acc.email_destinatario);
  v_raw   := trim(p_descripcion);

  PERFORM set_config('app.skip_admin_assert', 'on', true);

  -- F4: entra PENDIENTE (visible_cliente=false → el trigger NO notifica al
  -- cliente; la rama categoria='gestor_avance' SÍ alerta a gerencia).
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente,
    moderacion_estado, gestor_descripcion_original, gestor_label
  ) VALUES (
    v_sol.tramite_id, 'gestor_avance', v_raw, COALESCE(p_archivos_urls, '{}'::text[]),
    NULL, false, 'pendiente', v_raw, v_label
  )
  RETURNING tracking_lineas.id INTO v_linea_id;

  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()),
         ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE public.accesos_externos.token = p_token;

  RETURN v_linea_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4 · RPC de moderación (staff). Una sola acción 'publicar' cubre a/b/c (con
--     edición opcional de texto/adjuntos y cambio de estado opcional);
--     'interno' (d) y 'descartar' (e) son acciones propias.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_moderar_gestor_avance(
  p_linea_id uuid,
  p_accion text,                              -- 'publicar' | 'interno' | 'descartar'
  p_descripcion text DEFAULT NULL,            -- si no-null, reemplaza el texto (edición, b)
  p_archivos_urls text[] DEFAULT NULL,        -- si no-null, reemplaza los adjuntos (b)
  p_estado_asociado text DEFAULT NULL,        -- si no-null al publicar, cambia el estado del trámite (c)
  p_motivo text DEFAULT NULL                  -- motivo de descarte (e)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede moderar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_linea.categoria <> 'gestor_avance' OR v_linea.moderacion_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La línea no está pendiente de moderación' USING ERRCODE = '22023';
  END IF;

  -- Edición de texto/adjuntos (b) — aplica a publicar e interno.
  IF p_descripcion IS NOT NULL THEN
    UPDATE public.tracking_lineas SET descripcion = trim(p_descripcion) WHERE id = p_linea_id;
  END IF;
  IF p_archivos_urls IS NOT NULL THEN
    UPDATE public.tracking_lineas SET archivos_urls = p_archivos_urls WHERE id = p_linea_id;
  END IF;

  IF p_accion = 'publicar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = true, moderacion_estado = 'publicado',
           estado_asociado = COALESCE(p_estado_asociado, estado_asociado),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;
    -- (c) cambio de estado del trámite
    IF p_estado_asociado IS NOT NULL
       AND p_estado_asociado IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado') THEN
      UPDATE public.tramites SET estado = p_estado_asociado, ultima_actividad_at = now()
       WHERE id = v_linea.tramite_id;
    END IF;
    -- notificar al cliente (recién ahora)
    PERFORM private.tracking_notificar_avance_cliente(p_linea_id);

  ELSIF p_accion = 'interno' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'interno',
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSIF p_accion = 'descartar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'descartado',
           descarte_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · RPC de la cola de moderación (staff): aportes pendientes de TODOS los
--     trámites, con contexto (servicio, cliente, código).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_moderacion_pendientes()
RETURNS TABLE (
  linea_id uuid,
  tramite_id uuid,
  tramite_codigo text,
  servicio_nombre text,
  cliente_nombre text,
  gestor_label text,
  descripcion text,
  archivos_urls text[],
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT tl.id, t.id, t.codigo,
         COALESCE(s.nombre, t.titulo, 'Trámite'),
         COALESCE(a.nombre, t.solicitante_nombre),
         tl.gestor_label, tl.descripcion, tl.archivos_urls, tl.created_at
  FROM public.tracking_lineas tl
  JOIN public.tramites t ON t.id = tl.tramite_id
  LEFT JOIN public.servicios s ON s.id = t.servicio_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE tl.categoria = 'gestor_avance'
    AND tl.moderacion_estado = 'pendiente'
    AND private.is_staff()
  ORDER BY tl.created_at ASC;
$function$;
REVOKE EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · El trigger usa el helper para la rama visible_cliente=true (sin drift) y
--     reetiqueta la alerta de gestor_avance como "pendiente de revisión".
--     El resto de las ramas (recordatorio, movimiento del cliente) intactas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite           record;
  v_servicio_nombre   text;
  v_to_email          text;
  v_to_nombre         text;
  v_autor_role        text;
  v_autor_admin_id    uuid;
  v_archivos_count    int;
BEGIN
  BEGIN
    UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = NEW.tramite_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NEW.autor_id IS NOT NULL THEN
    SELECT role, administracion_id INTO v_autor_role, v_autor_admin_id
      FROM public.profiles WHERE id = NEW.autor_id;
  END IF;
  v_archivos_count := COALESCE(array_length(NEW.archivos_urls, 1), 0);
  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now())
     AND NEW.visible_cliente = false
     AND NOT (v_autor_role = 'administrador')
     AND NEW.categoria <> 'gestor_avance' THEN
    RETURN NEW;
  END IF;

  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = NEW.tramite_id;
  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_to_email := v_tramite.solicitante_email;
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  -- Recordatorio futuro al cliente.
  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_email(
        'tracking-recordatorio', v_to_email, v_to_nombre,
        jsonb_build_object('tipo', v_servicio_nombre, 'descripcion', NEW.descripcion,
          'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', NEW.id, 5::smallint
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Avance visible al cliente (líneas de staff publicadas directo). F4: las del
  -- gestor entran visible_cliente=false (pendiente) → no pasan por acá; se
  -- notifica al publicar vía la RPC de moderación (mismo helper).
  IF NEW.visible_cliente = true THEN
    PERFORM private.tracking_notificar_avance_cliente(NEW.id);
  END IF;

  -- Movimiento del cliente (nota/archivos del administrador) → avisa a gerencia.
  IF v_autor_role = 'administrador' THEN
    DECLARE
      v_titulo text := CASE WHEN v_archivos_count > 0
                            THEN 'Cliente subió archivos: ' || v_servicio_nombre
                            ELSE 'Cliente agregó nota: ' || v_servicio_nombre END;
      v_cuerpo text := COALESCE(NULLIF(v_to_nombre, ''), 'El administrador') || ' · '
        || substring(NEW.descripcion, 1, 160)
        || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END;
    BEGIN
      PERFORM public.notify_all_gerentes(
        'tracking_cliente_movimiento', v_titulo, v_cuerpo,
        '/gestion/tracking/' || NEW.tramite_id::text,
        jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id,
          'administracion_id', v_autor_admin_id, 'archivos_count', v_archivos_count),
        true, 'gerencia-notif-generica', NULL, 3::smallint, 'tracking_lineas', NEW.id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- F4: aporte del gestor → alerta a gerencia de que hay algo PENDIENTE DE REVISIÓN.
  IF NEW.categoria = 'gestor_avance' THEN
    BEGIN
      PERFORM public.notify_all_gerentes(
        'tracking_gestor_avance',
        'Aporte de gestoría PENDIENTE de revisión: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 200)
          || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END,
        '/gestion/tracking/' || NEW.tramite_id::text,
        jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id,
          'servicio', v_servicio_nombre, 'archivos_count', v_archivos_count, 'moderacion', 'pendiente'),
        true, 'gerencia-notif-generica', NULL, 3::smallint, 'tracking_lineas', NEW.id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Smoke no mutante (el e2e mutante con submission real va aparte, R18).
DO $smoke$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tracking_moderacion_pendientes();
  RAISE NOTICE 'smoke 0215 OK · pendientes de moderación hoy = %', n;
END
$smoke$;
