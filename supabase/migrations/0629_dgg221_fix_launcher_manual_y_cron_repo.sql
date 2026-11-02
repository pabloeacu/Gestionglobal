-- 0629_dgg221_fix_launcher_manual_y_cron_repo.sql
-- DGG-221 · §6 hallazgo H1: espejar el fix de 0628 en el launcher MANUAL de campañas.
-- --------------------------------------------------------------------------
-- La auditoría transversal §6 (fan-out, 2-bis·a) detectó que el fix de 0628
-- (no re-encolar direcciones fallidas) se aplicó SÓLO al tick automático
-- `prospectos_campana_tick`, pero NO a los dos consumidores manuales que
-- comparten la misma compuerta de cola:
--   - `prospectos_enviar_campana`  (gerente dispara una campaña a mano)
--   - `prospectos_preview_campana` (muestra cuántos "elegibles" hay)
-- Ambos seguían con `q.enviado_at IS NULL` → un gerente podía re-encolar a mano
-- un prospecto cuyo envío falló en los últimos 30d, y el preview sobrecontaba
-- "elegibles" (incoherencia aviso↔display, §6·e / R19). Daño acotado (manual,
-- is_staff-gated, los @padron.invalid ya excluidos) pero hay que cerrarlo para
-- no re-divergir. Cambio idéntico a 0628: la compuerta de cola excluye CUALQUIER
-- fila de email_queue en la ventana de gracia (sent/pending/failed), no sólo las
-- pendientes. Misma firma (R16 ok). CREATE OR REPLACE preserva grants (0622).
-- H5: se refleja en el repo el cron ya acelerado a */10 en runtime (2026-11-01).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prospectos_enviar_campana(p_template_slug text, p_segmento text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
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
  IF (SELECT COALESCE(prospectos_pausado_reputacion, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_pausado', 'pausado', true, 'encolados', 0);
  END IF;
  IF p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida')
     AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_de_vencimiento_requiere_segmento');
  END IF;
  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = p_template_slug AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'template_inexistente'); END IF;

  FOR v_p IN
    SELECT p.id, p.nombre, p.email, p.matricula_vencimiento
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
      AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND p.email NOT LIKE '%@padron.invalid'
      AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
      AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
      AND NOT (p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida') AND p.en_tramite)
    ORDER BY p.matricula_vencimiento ASC NULLS LAST
  LOOP
    EXIT WHEN v_toques >= v_lim;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    CONTINUE WHEN NOT p_forzar AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = p_template_slug
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_dias := CASE WHEN v_p.matricula_vencimiento IS NOT NULL THEN GREATEST(0, (v_p.matricula_vencimiento - v_hoy)) END;
    v_pila := public.prospecto_nombre_pila(v_p.nombre);
    v_vars := jsonb_build_object('nombre', v_pila);
    IF v_p.matricula_vencimiento IS NOT NULL THEN
      v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento,'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
    END IF;
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'encolados', v_toques, 'template', p_template_slug, 'segmento', p_segmento, 'forzado', p_forzar);
END $function$;

CREATE OR REPLACE FUNCTION public.prospectos_preview_campana(p_template_slug text, p_segmento text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_tpl_ok boolean; v_es_venc boolean; v_bloqueado boolean;
  v_en_seg int; v_sin_email int; v_suprimidos int; v_en_gracia int; v_en_cooldown int; v_elegibles int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.email_templates WHERE slug = p_template_slug AND activo) INTO v_tpl_ok;
  v_es_venc := p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida');
  v_bloqueado := v_es_venc AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90');

  WITH pool AS (
    SELECT p.id, p.email,
           (p.email LIKE '%@padron.invalid') AS no_email,
           public.email_esta_suprimido(p.email) AS supr,
           (EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                     AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
            OR EXISTS(SELECT 1 FROM public.email_queue q WHERE q.related_table = 'prospectos'
                     AND q.related_id = p.id
                     AND q.created_at >= (v_hoy - v_gracia)::timestamptz)) AS en_gracia,
           EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                    AND pm.template_slug = p_template_slug
                    AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) AS en_cd
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
      AND NOT (v_es_venc AND p.en_tramite)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE no_email),
    count(*) FILTER (WHERE NOT no_email AND supr),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND en_gracia),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND en_cd),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND NOT en_cd)
  INTO v_en_seg, v_sin_email, v_suprimidos, v_en_gracia, v_en_cooldown, v_elegibles
  FROM pool;

  RETURN jsonb_build_object(
    'template', p_template_slug, 'template_existe', COALESCE(v_tpl_ok, false),
    'segmento', p_segmento, 'es_de_vencimiento', v_es_venc, 'bloqueado_guard', v_bloqueado,
    'en_segmento', COALESCE(v_en_seg, 0),
    'sin_email', COALESCE(v_sin_email, 0),
    'suprimidos', COALESCE(v_suprimidos, 0),
    'en_gracia', COALESCE(v_en_gracia, 0),
    'en_cooldown', COALESCE(v_en_cooldown, 0),
    'elegibles', CASE WHEN v_bloqueado OR NOT COALESCE(v_tpl_ok, false) THEN 0 ELSE COALESCE(v_elegibles, 0) END
  );
END $function$;

-- H5 · reflejar el cron acelerado a */10 (ya aplicado en runtime el 2026-11-01).
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prospectos-campanas-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '*/10 * * * *');
  END IF;
END $$;
