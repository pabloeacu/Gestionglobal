-- ============================================================================
-- 0170 · DGG-33 / E-GG-35 · Notif unificada a TODOS los gerentes
--
-- Decisión arquitectónica (2026-06-02): Gestión Global NO tiene asignaciones
-- individuales. Todos los gerentes ven todo y se ocupan de todo. Una sola
-- agenda compartida. Consecuencia: cualquier evento que merezca atención de
-- la gerencia debe disparar push + banner in-app + email a TODOS los usuarios
-- con rol `gerente` (también `operador`).
--
-- Esta mig:
--   A) Crea template `gerencia-notif-generica` (subject + body parametrizado
--      por variables) para que cualquier evento de gerencia tenga email sin
--      necesidad de crear template por evento.
--   B) Crea helper `public.notify_all_gerentes(...)` que dispara los 3
--      canales en una sola llamada:
--        - in-app vía `private.notif_emitir` (cada gerente)
--        - push web automático (mig 0163 escala notif_emitir → push queue)
--        - email opcional (default ON) usando template genérico o uno
--          específico vía `p_template_slug`.
--   C) Reescribe `public.tracking_linea_on_insert` (vigente desde 0105):
--        - Bloque "cliente sube nota/archivo en su tracking" — elimina el
--          anti-patrón `IF v_asignado_a IS NOT NULL THEN notif_emitir(uno)
--          ELSE notif_emitir_staff(...)`. Ahora SIEMPRE notifica a todos los
--          gerentes con email.
--        - Bloque "gestor externo carga avance" — pasa de notif_emitir_staff
--          (2 canales) a notify_all_gerentes (3 canales con email).
--   D) Reescribe `public._notif_tracking_cerrado_trg` para sumar email.
--   E) Reescribe `private.dispatch_alarmas_tracking_hoy` para sumar email.
--   F) Trigger AFTER INSERT en `public.movimientos` que cuando es ingreso
--      desde facturación dispara `notify_all_gerentes('cobranza_recibida',
--      ...)`. Cierra GAP-2 (gerencia se entera de cobranzas).
--
-- Reglas: 1 (persistencia BD), 2 (RLS), 5 (SECURITY DEFINER), 8 (naming).
-- Ref: agentes ASIG-A/B/C, reporte 2026-06-02.
-- ============================================================================

-- =========================================================================
-- (A) Template email genérico para gerencia
-- =========================================================================
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html, body_text, from_casilla, activo, descripcion
)
SELECT
  'gerencia-notif-generica',
  'Notificación interna a gerencia',
  '{{titulo_evento}} · Gestión Global',
  $$<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
      <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:#0e7490">Notificación interna</p>
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">{{titulo_evento}}</h1>
      <p style="margin:0 0 18px;color:#0f172a;white-space:pre-wrap">{{cuerpo}}</p>
      <a href="https://www.gestionglobal.ar{{url}}" style="display:inline-block;background:#0e7490;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Abrir en la plataforma</a>
      <p style="margin-top:24px;font-size:12px;color:#64748b">Este aviso se envió a todos los gerentes de Gestión Global porque la atención del equipo es compartida (sin asignaciones individuales).</p>
    </div>
  </body></html>$$,
  $${{titulo_evento}}

{{cuerpo}}

Abrir: https://www.gestionglobal.ar{{url}}

— Equipo Gestión Global$$,
  'general',
  true,
  'DGG-33 · Email genérico de notif interna a gerencia. Se usa por default desde public.notify_all_gerentes cuando no se pasa template específico.'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = 'gerencia-notif-generica');

-- =========================================================================
-- (B) Helper consolidado: 3 canales a todos los gerentes
-- =========================================================================
CREATE OR REPLACE FUNCTION public.notify_all_gerentes(
  p_evento_codigo  text,
  p_titulo         text,
  p_cuerpo         text DEFAULT NULL,
  p_url            text DEFAULT NULL,
  p_payload        jsonb DEFAULT '{}'::jsonb,
  p_send_email     boolean DEFAULT true,
  p_template_slug  text DEFAULT 'gerencia-notif-generica',
  p_email_vars     jsonb DEFAULT NULL,
  p_prioridad      smallint DEFAULT 4::smallint,
  p_related_table  text DEFAULT NULL,
  p_related_id     uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_count int := 0;
  v_email_vars jsonb;
BEGIN
  -- Vars del email: por default {titulo_evento, cuerpo, url, evento_codigo}.
  -- Si p_email_vars viene, se mergea por arriba.
  v_email_vars := jsonb_build_object(
    'titulo_evento', p_titulo,
    'cuerpo',        COALESCE(p_cuerpo, ''),
    'url',           COALESCE(p_url, '/'),
    'evento_codigo', p_evento_codigo
  ) || COALESCE(p_email_vars, '{}'::jsonb);

  FOR r IN
    SELECT p.id AS user_id, u.email
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.role IN ('gerente', 'operador')
       AND COALESCE(p.activo, true) = true
  LOOP
    -- 1) in-app + push (notif_emitir escala a push si user tiene subs)
    BEGIN
      PERFORM private.notif_emitir(
        r.user_id, p_evento_codigo, p_titulo, p_cuerpo, p_url, p_payload
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_all_gerentes: notif_emitir fail user=% evt=%: %',
        r.user_id, p_evento_codigo, SQLERRM;
    END;

    -- 2) email (opcional pero default ON)
    IF p_send_email = true
       AND r.email IS NOT NULL
       AND length(trim(r.email)) > 0
       AND p_template_slug IS NOT NULL THEN
      BEGIN
        INSERT INTO public.email_queue (
          kind, template_slug, to_email, to_nombre, variables,
          prioridad, intento, max_intentos, programado_para,
          related_table, related_id
        ) VALUES (
          'workflow', p_template_slug, r.email, NULL, v_email_vars,
          COALESCE(p_prioridad, 4::smallint), 0, 3, now(),
          p_related_table, p_related_id
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_all_gerentes: email fail user=% evt=%: %',
          r.user_id, p_evento_codigo, SQLERRM;
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.notify_all_gerentes IS
  'DGG-33 · Fan-out a TODOS los gerentes/operadores activos en los 3 canales (in-app + push + email). Sin asignaciones individuales.';

REVOKE EXECUTE ON FUNCTION public.notify_all_gerentes(text,text,text,text,jsonb,boolean,text,jsonb,smallint,text,uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.notify_all_gerentes(text,text,text,text,jsonb,boolean,text,jsonb,smallint,text,uuid)
  TO authenticated;

-- =========================================================================
-- (C) tracking_linea_on_insert · fan-out siempre, sin asignado_a
-- =========================================================================
-- Reescribimos la versión vigente (mig 0105). Cambios respecto a 0105:
--   - Línea ~151-155 (bloque "cliente sube"): eliminamos el IF v_asignado_a
--     IS NOT NULL THEN notif_emitir(uno) ELSE notif_emitir_staff(). Ahora
--     siempre llamamos notify_all_gerentes (los 3 canales).
--   - Línea ~161-178 (bloque "gestor_avance"): pasamos de notif_emitir_staff
--     (2 canales) a notify_all_gerentes (3 canales, suma email).
--   - El bloque "visible_cliente=true" (al cliente admin) queda intacto.
--   - El email recordatorio (`alerta_en > now()`) queda intacto.

CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $function$
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

  -- Early return relaxed: dejar pasar también cuando es aporte de gestoría externa
  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now())
     AND NEW.visible_cliente = false
     AND NOT (v_autor_role = 'administrador')
     AND NEW.categoria <> 'gestor_avance' THEN
    RETURN NEW;
  END IF;

  SELECT t.*, s.nombre AS svc_nombre
    INTO v_tramite
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

  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  v_portal_url   := 'https://www.gestionglobal.ar/portal/mis-gestiones/' || NEW.tramite_id::text;
  v_gerencia_url := 'https://www.gestionglobal.ar/gestion/tracking/' || NEW.tramite_id::text;

  -- (1) Recordatorio email al cliente (sin cambios respecto a 0105)
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

  -- (2) Avance visible al cliente admin (sin cambios respecto a 0105)
  IF NEW.visible_cliente = true THEN
    IF v_to_email IS NOT NULL THEN
      BEGIN
        PERFORM public.encolar_email(
          'tracking-avance-cliente', v_to_email, v_to_nombre,
          jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
            'tipo', v_servicio_nombre, 'descripcion', NEW.descripcion, 'portal_url', v_portal_url),
          v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', NEW.id, 3::smallint
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF v_admin_user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_servicio_nombre,
          substring(NEW.descripcion, 1, 140), NULL, v_portal_url);
      EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance',
          'Nuevo avance: ' || v_servicio_nombre, substring(NEW.descripcion, 1, 200),
          '/portal/mis-gestiones/' || NEW.tramite_id::text,
          jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id, 'servicio', v_servicio_nombre));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  -- (3) Cliente admin sube nota/archivo en su tracking → AVISO A TODA LA GERENCIA
  --     Cambio DGG-33: eliminamos el IF v_asignado_a IS NOT NULL del 0105.
  --     Ahora siempre fan-out a todos los gerentes en los 3 canales.
  IF v_autor_role = 'administrador' THEN
    DECLARE
      v_titulo text := CASE WHEN v_archivos_count > 0
                            THEN 'Cliente subió archivos: ' || v_servicio_nombre
                            ELSE 'Cliente agregó nota: ' || v_servicio_nombre END;
      v_cuerpo text := COALESCE(NULLIF(v_to_nombre, ''), 'El administrador') || ' · '
        || substring(NEW.descripcion, 1, 160)
        || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END;
      v_url text := '/gestion/tracking/' || NEW.tramite_id::text;
      v_payload jsonb := jsonb_build_object(
        'tramite_id', NEW.tramite_id, 'linea_id', NEW.id,
        'administracion_id', v_autor_admin_id, 'archivos_count', v_archivos_count
      );
    BEGIN
      BEGIN
        PERFORM public.notify_all_gerentes(
          'tracking_cliente_movimiento', v_titulo, v_cuerpo, v_url, v_payload,
          true, 'gerencia-notif-generica', NULL, 3::smallint,
          'tracking_lineas', NEW.id
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END IF;

  -- (4) Gestoría externa carga avance → AVISO A TODA LA GERENCIA con email
  IF NEW.categoria = 'gestor_avance' THEN
    BEGIN
      PERFORM public.notify_all_gerentes(
        'tracking_gestor_avance',
        'Gestoría externa cargó avance: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 200)
          || CASE WHEN v_archivos_count > 0
                  THEN ' (' || v_archivos_count || ' archivo/s adjunto/s)'
                  ELSE '' END,
        '/gestion/tracking/' || NEW.tramite_id::text,
        jsonb_build_object(
          'tramite_id', NEW.tramite_id, 'linea_id', NEW.id,
          'servicio', v_servicio_nombre, 'archivos_count', v_archivos_count
        ),
        true, 'gerencia-notif-generica', NULL, 3::smallint,
        'tracking_lineas', NEW.id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================================
-- (D) Tracking cerrado · sumar email
-- =========================================================================
CREATE OR REPLACE FUNCTION public._notif_tracking_cerrado_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (OLD.estado IS DISTINCT FROM NEW.estado)
     AND NEW.estado IN ('cerrado', 'resuelto') THEN
    PERFORM public.notify_all_gerentes(
      'tracking_cerrado',
      'Trámite cerrado · ' || COALESCE(NEW.titulo, NEW.codigo),
      'Estado: ' || NEW.estado,
      '/gerencia/trackings/' || NEW.id::text,
      jsonb_build_object('tracking_id', NEW.id, 'estado_nuevo', NEW.estado),
      true, 'gerencia-notif-generica', NULL, 4::smallint,
      'tramites', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- =========================================================================
-- (E) Alarmas tracking · sumar email
-- =========================================================================
CREATE OR REPLACE FUNCTION private.dispatch_alarmas_tracking_hoy()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT tl.id, tl.descripcion, tl.alerta_en,
           t.id AS tramite_id, t.codigo, t.titulo,
           (tl.alerta_en < CURRENT_DATE) AS vencida
      FROM public.tracking_lineas tl
      JOIN public.tramites t ON t.id = tl.tramite_id
     WHERE tl.alerta_en IS NOT NULL
       AND tl.alerta_en::date <= CURRENT_DATE
       AND t.estado NOT IN ('resuelto','cerrado','cancelado')
       AND (tl.alarma_dispatched_at IS NULL
            OR tl.alarma_dispatched_at::date < CURRENT_DATE)
  LOOP
    BEGIN
      PERFORM public.notify_all_gerentes(
        'tracking_alarma',
        CASE WHEN r.vencida THEN '⚠ Alarma vencida: ' ELSE 'Alarma de hoy: ' END
          || COALESCE(NULLIF(r.titulo, ''), r.codigo),
        substring(COALESCE(r.descripcion, '') FROM 1 FOR 200),
        '/gerencia/trackings/' || r.tramite_id::text,
        jsonb_build_object(
          'linea_id', r.id,
          'tramite_id', r.tramite_id,
          'vencida', r.vencida,
          'alerta_en', r.alerta_en
        ),
        true, 'gerencia-notif-generica', NULL, 3::smallint,
        'tracking_lineas', r.id
      );
      UPDATE public.tracking_lineas
         SET alarma_dispatched_at = now()
       WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'dispatch_alarmas_tracking_hoy: falla linea_id=%: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;

-- =========================================================================
-- (F) Trigger NUEVO sobre movimientos · aviso a gerencia cuando entra cobranza
-- =========================================================================
-- Se dispara cuando se crea un movimiento de tipo `ingreso` originado en
-- `facturacion` (i.e. una cobranza imputada a un comprobante via
-- registrar_cobranza_comprobante, 0010_rpc_cobranzas.sql). Cierra GAP-2.

CREATE OR REPLACE FUNCTION public._notif_cobranza_recibida_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin_nombre text;
  v_comp record;
  v_titulo text;
  v_cuerpo text;
BEGIN
  -- Sólo cuando es ingreso desde facturación (cobranza).
  IF NEW.tipo <> 'ingreso' OR COALESCE(NEW.origen, '') <> 'facturacion' THEN
    RETURN NEW;
  END IF;

  IF NEW.administracion_id IS NOT NULL THEN
    SELECT nombre INTO v_admin_nombre
      FROM public.administraciones WHERE id = NEW.administracion_id;
  END IF;

  IF NEW.comprobante_id IS NOT NULL THEN
    SELECT c.tipo, c.numero, c.punto_venta, c.total
      INTO v_comp
      FROM public.comprobantes c WHERE c.id = NEW.comprobante_id;
  END IF;

  v_titulo := 'Cobranza recibida · $' || to_char(NEW.monto, 'FM999G999G990D00')
    || COALESCE(' · ' || v_admin_nombre, '');
  v_cuerpo := COALESCE(NULLIF(NEW.descripcion, ''),
                       'Cobranza imputada al comprobante')
    || CASE WHEN v_comp.numero IS NOT NULL
            THEN ' (' || COALESCE(v_comp.tipo, '') || ' '
                 || lpad(COALESCE(v_comp.punto_venta::text, '0001'), 4, '0') || '-'
                 || lpad(v_comp.numero::text, 8, '0') || ')'
            ELSE '' END;

  PERFORM public.notify_all_gerentes(
    'cobranza_recibida', v_titulo, v_cuerpo,
    CASE WHEN NEW.comprobante_id IS NOT NULL
         THEN '/gerencia/comprobantes/' || NEW.comprobante_id::text
         ELSE '/gerencia/finanzas/movimientos' END,
    jsonb_build_object(
      'movimiento_id', NEW.id,
      'monto', NEW.monto,
      'comprobante_id', NEW.comprobante_id,
      'administracion_id', NEW.administracion_id
    ),
    true, 'gerencia-notif-generica', NULL, 3::smallint,
    'movimientos', NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_cobranza_recibida ON public.movimientos;
CREATE TRIGGER trg_notif_cobranza_recibida
  AFTER INSERT ON public.movimientos
  FOR EACH ROW
  WHEN (NEW.tipo = 'ingreso' AND NEW.origen = 'facturacion')
  EXECUTE FUNCTION public._notif_cobranza_recibida_trg();

COMMENT ON FUNCTION public._notif_cobranza_recibida_trg IS
  'DGG-33 · Notifica a TODA la gerencia cuando entra una cobranza imputada (origen facturacion).';
