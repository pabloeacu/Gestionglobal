-- 0621_dgg221_motor_en_tramite_revisita_resume.sql
-- DGG-221 · Captación — "vencida pero en trámite": gate del motor + revisita + reanudación.
-- --------------------------------------------------------------------------
-- Capitaliza el caso Bernardo Giles (legajo 274696): matrícula vencida
-- (último INSCRIPTO 10/09/2025 → vence 10/09/2026) PERO con una RENOVACION DE
-- MATRICULA · INICIADO 29/10/2026 → ya empezó a renovar por su cuenta. El parser
-- (mig 0620 + edge tramix-prospectos v3) lo marca `renovacion_en_tramite` y hace
-- rollup a `prospectos.en_tramite`. Esta migración:
--
--   1) MOTOR (prospectos_campana_tick): un prospecto `en_tramite` NO recibe el pile
--      de vencimiento (captacion-vencida/curso-reno/curso-3190) — "no hay nada que
--      regularizar, ya está renovando" (decisión de Pablo). SÍ sigue en el universo
--      de bondades (marketing de la plataforma). Cambio quirúrgico: `en_tramite`
--      expuesto en `elig` + `AND NOT n.en_tramite` en `venc_pending`. Nada más cambia.
--      Firma idéntica (sin args) → CREATE OR REPLACE sin riesgo de overload (R16).
--
--   2) REVISITA (prospectos_revisita_en_tramite + cron, 1 y 16 de cada mes): re-encola
--      los padrón `en_tramite` al goteo TRAMIX para que, cuando su renovación pase a
--      INSCRIPTO, se actualice la fecha y se limpie el flag. Pace sin cambios (goteo
--      1/min, único consumidor — guardrail DGG-216). "Aprox. cada 15 días" (Pablo).
--
--   3) REANUDACIÓN (prospectos_reverify_watcher + cron, cada 30 min): soporte para la
--      pausa-por-revisión que pidió Pablo ("pará todos los envíos hasta revisar todos
--      los casos; re-verificá los 1500; después reanudá tal cual"). Mientras el
--      sentinel `config_global.prospectos_reverify_en_curso` esté activo el motor
--      queda OFF; cuando la cola de scraping drena por completo, el watcher reanuda
--      TAL CUAL (flag ON + reactiva cron prospectos-campanas-tick) y avisa a gerencia.
--      No toca nada si el sentinel está en false (no-op barato).
--
-- SECURITY DEFINER + search_path fijo en las 3 (acceden a tablas RLS y a cron).
-- Aditivo: ninguna firma ni columna existente cambia de forma.
-- --------------------------------------------------------------------------

-- Sentinel de "re-verificación en curso" (pausa deliberada del motor).
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS prospectos_reverify_en_curso boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.config_global.prospectos_reverify_en_curso IS
  'DGG-221: mientras true, el motor de captación queda pausado a propósito (re-verificación de vencidos contra TRAMIX en curso). El watcher reanuda cuando la cola de scraping drena.';

-- ==========================================================================
-- 1) MOTOR con gate en_tramite (resto idéntico a la versión previa)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.prospectos_campana_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
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

  IF NOT COALESCE(v_activo, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'gated', 'activo', false); END IF;
  IF COALESCE(v_pausado, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'pausado_reputacion'); END IF;

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
      PERFORM public.notify_all_gerentes('prospectos_motor_pausado', 'Motor de captación auto-pausado (reputación)',
        format('Rebotes/quejas: %s de %s envíos (%s%%) en 7 días. El motor se detuvo solo para proteger la entregabilidad. Revisá y reactivá cuando quieras.',
          v_rep_bad, v_rep_total, round(v_rep_rate*100,1)),
        '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, false);
      RETURN jsonb_build_object('ok', true, 'accion', 'freno_reputacion', 'rate', round(v_rep_rate*100,1));
    END IF;
  END IF;

  SELECT count(*) INTO v_hoy_count FROM public.email_queue
   WHERE related_table = 'prospectos' AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap); END IF;

  v_target := (ARRAY['urgente','vencida','bondad'])[(v_hoy_count % 3) + 1];

  SELECT * INTO v_p FROM (
    WITH elig AS (
      SELECT p.id, p.nombre, p.email, p.matricula_vencimiento, p.en_tramite,
             public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg
      FROM public.prospectos p
      WHERE p.origen='padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
        AND p.email NOT LIKE '%@padron.invalid'
        AND NOT public.email_esta_suprimido(p.email)
        AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
        AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
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
        -- DGG-221: `en_tramite` ⇒ NO pile de vencimiento (ya está renovando). Sí bondades.
        (n.venc_tpl IS NOT NULL AND NOT n.en_tramite AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=n.venc_tpl)) AS venc_pending,
        (SELECT b FROM unnest(v_bondades) b WHERE NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=b) LIMIT 1) AS next_bondad
      FROM nx n
    ), fin AS (
      SELECT id, nombre, email, matricula_vencimiento, seg, n_mails,
        CASE WHEN venc_pending THEN venc_tpl ELSE next_bondad END AS tpl,
        CASE WHEN venc_pending THEN (CASE WHEN seg='vencida' THEN 'vencida' ELSE 'urgente' END) ELSE 'bondad' END AS bucket
      FROM nx2 WHERE venc_pending OR next_bondad IS NOT NULL
    )
    SELECT * FROM fin
    WHERE EXISTS (SELECT 1 FROM public.email_templates et WHERE et.slug = fin.tpl AND et.activo)
    ORDER BY (bucket = v_target) DESC,
             CASE bucket WHEN 'urgente' THEN 1 WHEN 'vencida' THEN 2 ELSE 3 END,
             CASE WHEN bucket='urgente' THEN matricula_vencimiento END ASC NULLS LAST,
             CASE WHEN bucket='vencida' THEN matricula_vencimiento END DESC NULLS LAST,
             CASE WHEN bucket='bondad' THEN n_mails END ASC NULLS LAST, id
    LIMIT 1
  ) s;

  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'accion', 'sin_candidatos', 'target', v_target); END IF;

  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_p.tpl AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_p.tpl); END IF;

  v_pila := public.prospecto_nombre_pila(v_p.nombre);
  v_vars := jsonb_build_object('nombre', v_pila);
  IF v_p.matricula_vencimiento IS NOT NULL THEN
    v_dias := GREATEST(0, (v_p.matricula_vencimiento - v_hoy));
    v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento, 'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
  END IF;

  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_p.tpl, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_p.tpl,
    'bucket', v_p.bucket, 'target', v_target, 'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $function$;

-- ==========================================================================
-- 2) REVISITA: re-encola los padrón en_tramite al goteo TRAMIX
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.prospectos_revisita_en_tramite()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  INSERT INTO public.prospecto_tramix_queue (padron_id, legajo, estado)
  SELECT pp.id, pp.legajo, 'pendiente'
    FROM public.prospecto_padron pp
   WHERE pp.renovacion_en_tramite = true
     AND pp.legajo IS NOT NULL AND pp.legajo <> ''
  ON CONFLICT (padron_id) DO UPDATE
    SET estado = 'pendiente', intentos = 0, resultado = NULL, updated_at = now()
    WHERE public.prospecto_tramix_queue.estado <> 'pendiente';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'reencoladas', v_n);
END $function$;

-- ==========================================================================
-- 3) WATCHER de reanudación tras la re-verificación
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.prospectos_reverify_watcher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_en_curso boolean; v_pend int; v_entram int; v_jobid bigint;
BEGIN
  SELECT prospectos_reverify_en_curso INTO v_en_curso FROM public.config_global LIMIT 1;
  IF NOT COALESCE(v_en_curso, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'sin_reverify');
  END IF;

  SELECT count(*) INTO v_pend FROM public.prospecto_tramix_queue
   WHERE estado IN ('pendiente','procesando');
  IF v_pend > 0 THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'esperando_drenaje', 'pendientes', v_pend);
  END IF;

  -- Drenaje completo → reanudar tal cual (flag ON + reactivar cron del motor).
  UPDATE public.config_global
     SET prospectos_campanas_activo = true,
         prospectos_reverify_en_curso = false;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prospectos-campanas-tick' LIMIT 1;
  IF v_jobid IS NOT NULL THEN PERFORM cron.alter_job(v_jobid, active := true); END IF;

  SELECT count(*) FILTER (WHERE en_tramite) INTO v_entram
    FROM public.prospectos
   WHERE origen='padron_pba' AND convertido_at IS NULL AND baja_at IS NULL;

  PERFORM public.notify_all_gerentes('prospectos_reverify_done',
    'Captación: re-verificación completa, motor reanudado',
    format('Se re-verificaron los vencidos contra TRAMIX. %s prospecto(s) quedaron en "vencida pero en trámite" (no reciben el mail de regularizar; sí marketing). El motor de captación se reanudó tal cual (mismo cap y cadencia).', v_entram),
    '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, false);

  RETURN jsonb_build_object('ok', true, 'accion', 'reanudado', 'en_tramite', v_entram);
END $function$;

-- Crons (idempotentes): revisita 1 y 16 de cada mes 06:00 ART (09:00 UTC); watcher cada 30 min.
SELECT cron.schedule('prospectos-revisita-en-tramite', '0 9 1,16 * *',
  $cron$ SELECT public.prospectos_revisita_en_tramite(); $cron$);
SELECT cron.schedule('prospectos-reverify-watcher', '*/30 * * * *',
  $cron$ SELECT public.prospectos_reverify_watcher(); $cron$);
