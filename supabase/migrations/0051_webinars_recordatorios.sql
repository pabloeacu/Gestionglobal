-- 0051_webinars_recordatorios.sql — Fase G de DGG-11/15
--
-- Recordatorios automáticos a inscriptos de webinars:
--   - Bienvenida: al inscribirse (trigger AFTER INSERT en acceso_tokens).
--   - 24h antes: cron cada 30 min.
--   - 1h antes: cron cada 15 min.
--
-- Plantillas seed en email_plantillas. La cola la procesa la edge fn
-- dispatch-emails existente (no se toca).

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) Plantillas seed (idempotente · ON CONFLICT)
-- ────────────────────────────────────────────────────────────────

-- email_templates (NO email_plantillas; el dispatcher lee de email_templates).
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, activo, variables)
VALUES
  (
    'webinar-bienvenida',
    'Webinar · Bienvenida',
    'Te inscribiste a {{webinar_titulo}} · Gestión Global',
    '<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">' ||
    '<h1 style="color:#0891b2;font-size:22px;margin-bottom:8px">¡Listo, {{nombre}}!</h1>' ||
    '<p>Tu lugar para el webinar <strong>{{webinar_titulo}}</strong> está reservado.</p>' ||
    '<p style="background:#f1f5f9;border-radius:8px;padding:12px;font-size:14px"><strong>Cuándo:</strong> {{fecha_humana}}<br/><strong>Duración:</strong> {{duracion_min}} min</p>' ||
    '<p>El día del evento, ingresá desde el link personal:</p>' ||
    '<p style="text-align:center;margin:24px 0"><a href="{{link_acceso}}" style="background:#0891b2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Ir al webinar</a></p>' ||
    '<p style="font-size:13px;color:#64748b">Te asignamos el canal <strong>{{canal_humano}}</strong>. Guardá este email — te lo va a recordar.</p>' ||
    '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>' ||
    '<p style="font-size:12px;color:#94a3b8">Gestión Global · gestionglobal.ar</p>' ||
    '</body></html>',
    'Hola {{nombre}}, te inscribiste al webinar {{webinar_titulo}} el {{fecha_humana}}. Canal: {{canal_humano}}. Acceso: {{link_acceso}}',
    'cursos',
    'Confirmación de inscripción a un webinar de Gestión Global.',
    true,
    jsonb_build_object(
      'nombre', 'string · nombre del inscripto',
      'webinar_titulo', 'string',
      'fecha_humana', 'string · fecha formateada AR',
      'duracion_min', 'integer',
      'canal_humano', 'string · "Zoom (con asistencia automática)" o "YouTube Live"',
      'link_acceso', 'string · URL pública /webinar/:token'
    )
  ),
  (
    'webinar-recordatorio-24h',
    'Webinar · Recordatorio 24h antes',
    '[Recordatorio] Mañana es {{webinar_titulo}} · Gestión Global',
    '<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">' ||
    '<h1 style="color:#0891b2;font-size:22px;margin-bottom:8px">Te esperamos mañana, {{nombre}}</h1>' ||
    '<p>El webinar <strong>{{webinar_titulo}}</strong> empieza en menos de 24 horas.</p>' ||
    '<p style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:12px;font-size:14px"><strong>{{fecha_humana}}</strong></p>' ||
    '<p style="text-align:center;margin:24px 0"><a href="{{link_acceso}}" style="background:#0891b2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Ir al webinar</a></p>' ||
    '<p style="font-size:13px;color:#64748b">Canal asignado: <strong>{{canal_humano}}</strong>.</p>' ||
    '</body></html>',
    'Hola {{nombre}}, mañana ({{fecha_humana}}) es el webinar {{webinar_titulo}}. Canal: {{canal_humano}}. Acceso: {{link_acceso}}',
    'cursos',
    'Recordatorio 24h antes del webinar.',
    true,
    '{}'::jsonb
  ),
  (
    'webinar-recordatorio-1h',
    'Webinar · Recordatorio 1h antes',
    'Empieza en una hora · {{webinar_titulo}}',
    '<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">' ||
    '<h1 style="color:#dc2626;font-size:22px;margin-bottom:8px">Falta poco, {{nombre}}</h1>' ||
    '<p>El webinar <strong>{{webinar_titulo}}</strong> empieza en una hora.</p>' ||
    '<p style="text-align:center;margin:24px 0"><a href="{{link_acceso}}" style="background:#dc2626;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Unirme ahora</a></p>' ||
    '<p style="font-size:13px;color:#64748b">Canal: <strong>{{canal_humano}}</strong>. El botón estará activo cuando el host inicie la reunión.</p>' ||
    '</body></html>',
    'Hola {{nombre}}, en 1h empieza el webinar {{webinar_titulo}}. Canal: {{canal_humano}}. Acceso: {{link_acceso}}',
    'cursos',
    'Recordatorio 1h antes del webinar.',
    true,
    '{}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE
  SET asunto = EXCLUDED.asunto,
      body_html = EXCLUDED.body_html,
      body_text = EXCLUDED.body_text,
      activo = true,
      updated_at = now();

-- ────────────────────────────────────────────────────────────────
-- 2) Helper · armar vars del webinar para plantillas
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.webinar_email_vars(
  p_inscripto_id uuid,
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ins record;
  v_web record;
  v_base_url text;
  v_canal_human text;
  v_fecha_human text;
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = p_inscripto_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = v_ins.webinar_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  -- Base URL: usar sitio_web de config_global, fallback al dominio oficial.
  SELECT COALESCE(NULLIF(sitio_web, ''), 'https://gestionglobal.ar')
    INTO v_base_url
    FROM public.config_global LIMIT 1;
  IF v_base_url IS NULL THEN v_base_url := 'https://gestionglobal.ar'; END IF;

  v_canal_human := CASE WHEN v_ins.canal = 'zoom' THEN 'Zoom (con asistencia automática)' ELSE 'YouTube Live' END;
  v_fecha_human := to_char(v_web.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'TMDay DD "de" TMMonth, HH24:MI "hs"');

  RETURN jsonb_build_object(
    'nombre', v_ins.nombre_snapshot,
    'webinar_titulo', v_web.titulo,
    'webinar_descripcion', COALESCE(v_web.descripcion, ''),
    'fecha_hora', v_web.fecha_hora,
    'fecha_humana', v_fecha_human,
    'duracion_min', v_web.duracion_min,
    'canal', v_ins.canal,
    'canal_humano', v_canal_human,
    'link_acceso', v_base_url || '/webinar/' || p_token
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION private.webinar_email_vars(uuid, text) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3) Trigger · email bienvenida cuando se crea el token de acceso
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_webinar_token_bienvenida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ins record;
  v_vars jsonb;
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = NEW.webinar_inscripto_id;
  IF NOT FOUND OR v_ins.bienvenida_email_enviada_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_vars := private.webinar_email_vars(NEW.webinar_inscripto_id, NEW.token);
  IF v_vars = '{}'::jsonb THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.encolar_email(
      'webinar-bienvenida',
      v_ins.email_snapshot,
      v_ins.nombre_snapshot,
      v_vars,
      NULL, NULL,
      'webinar_inscriptos', NEW.webinar_inscripto_id,
      3::smallint
    );
    UPDATE public.webinar_inscriptos
       SET bienvenida_email_enviada_at = now()
     WHERE id = NEW.webinar_inscripto_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_webinar_token_bienvenida: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_webinar_token_bienvenida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_webinar_token_bienvenida ON public.webinar_acceso_tokens;
CREATE TRIGGER trg_webinar_token_bienvenida
  AFTER INSERT ON public.webinar_acceso_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tg_webinar_token_bienvenida();

-- ────────────────────────────────────────────────────────────────
-- 4) Función de despacho de recordatorios · cron
-- ────────────────────────────────────────────────────────────────
-- Selecciona inscriptos cuyo webinar está en {24h ±30min} o {1h ±15min} y
-- todavía no recibieron el recordatorio correspondiente.

CREATE OR REPLACE FUNCTION public.gg_webinars_disparar_recordatorios()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_enviados_24h integer := 0;
  v_enviados_1h  integer := 0;
  v_inscripto record;
  v_token text;
  v_vars jsonb;
BEGIN
  -- 24h antes (ventana ±30 min). Solo webinars en 'programado'.
  FOR v_inscripto IN
    SELECT wi.id, wi.email_snapshot, wi.nombre_snapshot, wi.webinar_id, w.fecha_hora
      FROM public.webinar_inscriptos wi
      JOIN public.webinars w ON w.id = wi.webinar_id
     WHERE w.status = 'programado'
       AND w.fecha_hora BETWEEN v_now + interval '23 hours 30 minutes'
                              AND v_now + interval '24 hours 30 minutes'
       AND wi.recordatorio_24h_enviado_at IS NULL
  LOOP
    SELECT token INTO v_token
      FROM public.webinar_acceso_tokens
     WHERE webinar_inscripto_id = v_inscripto.id AND revocado_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_token IS NULL THEN CONTINUE; END IF;

    v_vars := private.webinar_email_vars(v_inscripto.id, v_token);
    IF v_vars = '{}'::jsonb THEN CONTINUE; END IF;

    BEGIN
      PERFORM public.encolar_email(
        'webinar-recordatorio-24h',
        v_inscripto.email_snapshot,
        v_inscripto.nombre_snapshot,
        v_vars,
        NULL, NULL,
        'webinar_inscriptos', v_inscripto.id,
        2::smallint
      );
      UPDATE public.webinar_inscriptos
         SET recordatorio_24h_enviado_at = v_now
       WHERE id = v_inscripto.id;
      v_enviados_24h := v_enviados_24h + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'recordatorio_24h inscripto=%: %', v_inscripto.id, SQLERRM;
    END;
  END LOOP;

  -- 1h antes (ventana ±15 min)
  FOR v_inscripto IN
    SELECT wi.id, wi.email_snapshot, wi.nombre_snapshot, wi.webinar_id, w.fecha_hora
      FROM public.webinar_inscriptos wi
      JOIN public.webinars w ON w.id = wi.webinar_id
     WHERE w.status IN ('programado','en_curso')
       AND w.fecha_hora BETWEEN v_now + interval '45 minutes'
                              AND v_now + interval '1 hour 15 minutes'
       AND wi.recordatorio_1h_enviado_at IS NULL
  LOOP
    SELECT token INTO v_token
      FROM public.webinar_acceso_tokens
     WHERE webinar_inscripto_id = v_inscripto.id AND revocado_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_token IS NULL THEN CONTINUE; END IF;

    v_vars := private.webinar_email_vars(v_inscripto.id, v_token);
    IF v_vars = '{}'::jsonb THEN CONTINUE; END IF;

    BEGIN
      PERFORM public.encolar_email(
        'webinar-recordatorio-1h',
        v_inscripto.email_snapshot,
        v_inscripto.nombre_snapshot,
        v_vars,
        NULL, NULL,
        'webinar_inscriptos', v_inscripto.id,
        1::smallint
      );
      UPDATE public.webinar_inscriptos
         SET recordatorio_1h_enviado_at = v_now
       WHERE id = v_inscripto.id;
      v_enviados_1h := v_enviados_1h + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'recordatorio_1h inscripto=%: %', v_inscripto.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'enviados_24h', v_enviados_24h,
    'enviados_1h', v_enviados_1h,
    'at', v_now
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_webinars_disparar_recordatorios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_webinars_disparar_recordatorios() TO service_role;

-- ────────────────────────────────────────────────────────────────
-- 5) Cron · cada 15 min
-- ────────────────────────────────────────────────────────────────
-- El cron unschedule + schedule es idempotente (re-aplicar la migración no
-- crea duplicados).

DO $$
BEGIN
  -- Asegurar que la extensión pg_cron esté en su schema habitual
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('gg-webinars-recordatorios') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'gg-webinars-recordatorios'
    );
    PERFORM cron.schedule(
      'gg-webinars-recordatorios',
      '*/15 * * * *',
      $cron$ SELECT public.gg_webinars_disparar_recordatorios(); $cron$
    );
  END IF;
END$$;

COMMIT;
