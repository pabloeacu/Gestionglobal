-- 0554_dgg221_motor_unificado.sql
-- =============================================================================
-- DGG-221 · Motor de campañas UNIFICADO (tick-based) para prospectos padrón PBA.
-- Reemplaza el motor diario (vencimiento-only, 25/día, todo-de-una) por un motor
-- que llega a TODOS paulatinamente, UNA campaña por persona por ciclo:
--   · Balanceado: round-robin por tick entre urgente / vencida / bondad.
--   · Cadencia: cap diario (default 50) + 1 envío por tick (cron cada 20 min).
--   · Rotación de bondades: campus → agenda → trámites → capacitaciones, sin repetir.
--   · No repite una campaña ya enviada (registro por línea en prospecto_mails).
--   · FRENO DE REPUTACIÓN: si rebotes/quejas de captación > umbral → auto-pausa + avisa.
-- Sigue GATED (prospectos_campanas_activo=false) hasta que Pablo active.
-- Server-side (pg_cron) → funciona con la compu de Pablo apagada.
-- =============================================================================

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS prospectos_cap_diario integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS prospectos_pausado_reputacion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prospectos_pausado_motivo text;

-- -----------------------------------------------------------------------------
-- TICK del motor: se llama cada 20 min por cron. Enví­a (encola) a lo sumo 1
-- mail por llamada, respetando el cap diario, el gate, el freno y la gracia.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_campana_tick()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_cap int;
  v_gracia int := 30;
  v_hoy_count int;
  v_rep_total int; v_rep_bad int; v_rep_rate numeric;
  v_target text; v_p record; v_asunto text; v_vars jsonb; v_dias int; v_pila text;
  v_bondades text[] := ARRAY['captacion-campus','captacion-agenda','captacion-tramites','captacion-capacitaciones'];
BEGIN
  SELECT prospectos_campanas_activo, prospectos_pausado_reputacion, prospectos_cap_diario
    INTO v_activo, v_pausado, v_cap FROM public.config_global LIMIT 1;

  IF NOT COALESCE(v_activo, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'gated', 'activo', false);
  END IF;
  IF COALESCE(v_pausado, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'pausado_reputacion');
  END IF;

  -- FRENO DE REPUTACIÓN: rebotes/quejas de captación en los últimos 7 días.
  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_rep_total, v_rep_bad
    FROM public.sent_emails
   WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  IF v_rep_total >= 20 THEN
    v_rep_rate := v_rep_bad::numeric / v_rep_total;
    IF v_rep_rate > 0.05 THEN
      UPDATE public.config_global
         SET prospectos_pausado_reputacion = true,
             prospectos_pausado_motivo = format('Auto-pausa %s: rebotes/quejas %s/%s (%s%%) en 7d supera el 5%%.',
               v_hoy, v_rep_bad, v_rep_total, round(v_rep_rate*100,1));
      PERFORM public.notify_all_gerentes(
        'prospectos_motor_pausado',
        'Motor de captación auto-pausado (reputación)',
        format('Rebotes/quejas: %s de %s envíos (%s%%) en 7 días. El motor se detuvo solo para proteger la entregabilidad. Revisá y reactivá cuando quieras.',
          v_rep_bad, v_rep_total, round(v_rep_rate*100,1)),
        '/gerencia/formularios/prospectos/captacion',
        '{}'::jsonb, false);
      RETURN jsonb_build_object('ok', true, 'accion', 'freno_reputacion', 'rate', round(v_rep_rate*100,1));
    END IF;
  END IF;

  -- cap diario: contamos lo encolado hoy (related_table='prospectos')
  SELECT count(*) INTO v_hoy_count
    FROM public.email_queue
   WHERE related_table = 'prospectos'
     AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap);
  END IF;

  -- round-robin del bucket objetivo según el nº de envío de hoy
  v_target := (ARRAY['urgente','vencida','bondad'])[(v_hoy_count % 3) + 1];

  -- elegir el ganador: elegibles → su próxima campaña → bucket → orden
  SELECT * INTO v_p FROM (
    WITH elig AS (
      SELECT p.id, p.nombre, p.email, p.matricula_vencimiento,
             public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg
      FROM public.prospectos p
      WHERE p.origen='padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
        AND p.email NOT LIKE '%@padron.invalid'
        AND NOT public.email_esta_suprimido(p.email)
        AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM public.email_queue q WHERE q.related_table='prospectos' AND q.related_id=p.id AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz)
    ), nx AS (
      SELECT e.*,
        CASE e.seg WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                   WHEN 'curso_31_90' THEN 'captacion-curso-3190'
                   WHEN 'vencida' THEN 'captacion-vencida' END AS venc_tpl,
        (SELECT count(*) FROM public.prospecto_mails pm WHERE pm.prospecto_id=e.id) AS n_mails
      FROM elig e
    ), nx2 AS (
      SELECT n.*,
        (n.venc_tpl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=n.venc_tpl)) AS venc_pending,
        (SELECT b FROM unnest(v_bondades) b
           WHERE NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=b)
           LIMIT 1) AS next_bondad
      FROM nx n
    ), fin AS (
      SELECT id, nombre, email, matricula_vencimiento, seg, n_mails,
        CASE WHEN venc_pending THEN venc_tpl ELSE next_bondad END AS tpl,
        CASE WHEN venc_pending THEN (CASE WHEN seg='vencida' THEN 'vencida' ELSE 'urgente' END) ELSE 'bondad' END AS bucket
      FROM nx2
      WHERE venc_pending OR next_bondad IS NOT NULL
    )
    SELECT * FROM fin
    ORDER BY (bucket = v_target) DESC,
             CASE bucket WHEN 'urgente' THEN 1 WHEN 'vencida' THEN 2 ELSE 3 END,
             CASE WHEN bucket='urgente' THEN matricula_vencimiento END ASC NULLS LAST,
             CASE WHEN bucket='vencida' THEN matricula_vencimiento END DESC NULLS LAST,
             CASE WHEN bucket='bondad' THEN n_mails END ASC NULLS LAST,
             id
    LIMIT 1
  ) s;

  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'sin_candidatos', 'target', v_target);
  END IF;

  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_p.tpl AND activo;
  IF v_asunto IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_p.tpl);
  END IF;

  v_pila := initcap(split_part(btrim(regexp_replace(v_p.nombre, '\s+', ' ', 'g')), ' ', 1));
  v_vars := jsonb_build_object('nombre', v_pila);
  IF v_p.matricula_vencimiento IS NOT NULL THEN
    v_dias := GREATEST(0, (v_p.matricula_vencimiento - v_hoy));
    v_vars := v_vars || jsonb_build_object(
      'fecha_vencimiento', to_char(v_p.matricula_vencimiento, 'DD/MM/YYYY'),
      'dias_restantes', v_dias::text);
  END IF;

  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_p.tpl, trim(v_p.email), initcap(v_p.nombre), v_vars, 8, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_p.tpl,
    'bucket', v_p.bucket, 'target', v_target, 'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_campana_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospectos_campana_tick() TO service_role;

-- -----------------------------------------------------------------------------
-- Envío MANUAL: agrega p_forzar (reenviar una campaña ya enviada = advertir, no
-- prohibir). Firma nueva → DROP de la vieja (R16). Mantiene gate + gracia + supresión.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospectos_enviar_campana(text, text, int);
CREATE FUNCTION public.prospectos_enviar_campana(
  p_template_slug text, p_segmento text DEFAULT NULL, p_limite int DEFAULT 50, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_lim int := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_asunto text; v_toques int := 0; v_p record; v_vars jsonb; v_dias int; v_pila text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT (SELECT COALESCE(prospectos_campanas_activo, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_desactivado', 'gated', true, 'encolados', 0);
  END IF;
  IF p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida')
     AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_de_vencimiento_requiere_segmento');
  END IF;
  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = p_template_slug AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'template_inexistente'); END IF;

  FOR v_p IN
    SELECT id, nombre, email, matricula_vencimiento
    FROM public.prospectos
    WHERE origen = 'padron_pba'
      AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid'
      AND (p_segmento IS NULL OR public.prospecto_segmento(matricula_vencimiento, v_hoy) = p_segmento)
    ORDER BY matricula_vencimiento ASC NULLS LAST
  LOOP
    EXIT WHEN v_toques >= v_lim;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    -- gracia + supresión SIEMPRE aplican (aún con forzar: no spamear).
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    -- cooldown por template: sólo se saltea si p_forzar (advertir, no prohibir).
    CONTINUE WHEN NOT p_forzar AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = p_template_slug
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_dias := CASE WHEN v_p.matricula_vencimiento IS NOT NULL THEN GREATEST(0, (v_p.matricula_vencimiento - v_hoy)) END;
    v_pila := initcap(split_part(btrim(regexp_replace(v_p.nombre, '\s+', ' ', 'g')), ' ', 1));
    v_vars := jsonb_build_object('nombre', v_pila);
    IF v_p.matricula_vencimiento IS NOT NULL THEN
      v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento,'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
    END IF;
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', p_template_slug, trim(v_p.email), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'encolados', v_toques, 'template', p_template_slug, 'segmento', p_segmento, 'forzado', p_forzar);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_enviar_campana(text, text, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_enviar_campana(text, text, int, boolean) TO authenticated, service_role;

-- Retiramos el motor diario viejo (lo reemplaza el tick).
DROP FUNCTION IF EXISTS public.prospectos_campanas_diario();
