-- 0734 · DGG-270 — Moderación del carril SES para el plan de Captación Federal (pedido de Pablo).
-- Dos cambios de gobernanza, ninguno dispara envíos:
--
-- (1) RAMPA DE WARM-UP más GRADUAL (reemplaza la default 500→1k→2,5k→5k→…→50k, que a Pablo
--     le resultaba poco moderada). Nuevo esquema +500 cada 2 días, calibrado al deadline del
--     curso RPA (inscripciones hasta 15/12) y a la matemática de Pablo:
--       "para el 1/12 un tope de 2.500/día; con 100 de captación PBA consumidos → 2.400 los
--        primeros dos días y 2.900 a partir del tercero → RPA CABA (7.835) en ~4 días".
--     warmup_inicio = 2026-11-25 (día 1). Esquema:
--       día 1-2  (25-26/11): 500      día 3-4  (27-28/11): 1.000
--       día 5-6  (29-30/11): 1.500    día 7-8  (01-02/12): 2.500   ← ≥2.500 el 1/12 (pedido)
--       día 9-10 (03-04/12): 3.000    día 11-12: 3.500   día 13-14: 4.000   día 15-16: 4.500
--       día 17+ : 5.000 (techo moderado; para un burst mayor, override explícito hasta 50k).
--     El único salto >500 es día6→7 (1.500→2.500) para cumplir el "2.500 el 1/12"; a esa altura
--     hay 6 días de envío limpio, y 2.500 sigue siendo la MITAD de lo que mandaba la rampa default
--     ese día (5.000). Mantiene el fix de huso AR (E-GG-299) y toda la lógica de pausa/override.
--
-- (2) CAPTACIÓN PBA a PRIORIDAD 7 (antes 8). Ahora que el marketing comparte el cupo SES, el
--     backlog de LexPH (prioridad 8) tapaba los ≤100/día time-sensitive de captación (vencimientos
--     de matrícula). Subirla a 7 (debajo del transaccional 1-5, encima de LexPH/federal 8-10)
--     garantiza que sus 100/día SIEMPRE pasen primero, y el resto del cupo lo llena LexPH. No cambia
--     el cap (100) ni el ritmo (1/tick, cada 10 min). Deja el orden de drenado del plan federal:
--       transaccional(1-5) < captación PBA(7) < LexPH e3(8) < RPA CABA(9) < consultoría(10).
--     ADEMÁS (fix necesario del plan): el contador del cap de captación ahora filtra
--     `template_slug LIKE 'captacion-%'`. Antes contaba TODAS las filas `related_table='prospectos'`
--     creadas hoy → al disparar la Captación Federal (también `related_table='prospectos'`, slug
--     `federal-%`), esas filas hubieran consumido el cupo de captación PBA y la habrían frenado en
--     seco. Con el filtro, el cap 100/día de PBA queda aislado del federal. Sin federal, el conteo
--     es idéntico al anterior (todo lo de prospectos era captación) → sin regresión.

-- ───────────────── (1) Rampa gradual (mantiene TimeZone AR de 0733) ─────────────────
CREATE OR REPLACE FUNCTION public.ses_warmup_cap_hoy()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
declare v_cfg record; v_dia int;
begin
  select ses_pausado_reputacion, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  if coalesce(v_cfg.ses_pausado_reputacion, false) then return 0; end if;
  if v_cfg.ses_warmup_cap_override is not null then
    return greatest(0, least(v_cfg.ses_warmup_cap_override, 50000));
  end if;
  if v_cfg.ses_warmup_inicio is null then return 0; end if;
  v_dia := (current_date - v_cfg.ses_warmup_inicio) + 1;  -- current_date en AR
  return case
    when v_dia <= 2  then 500
    when v_dia <= 4  then 1000
    when v_dia <= 6  then 1500
    when v_dia <= 8  then 2500
    when v_dia <= 10 then 3000
    when v_dia <= 12 then 3500
    when v_dia <= 14 then 4000
    when v_dia <= 16 then 4500
    else 5000 end;
end $function$;

-- ───────────────── (2) Captación PBA: prioridad 8 → 7 (resto idéntico) ─────────────────
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
   WHERE related_table = 'prospectos' AND template_slug LIKE 'captacion-%'
     AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
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
        AND NOT EXISTS (SELECT 1 FROM public.email_queue q WHERE q.related_table='prospectos' AND q.related_id=p.id AND q.created_at >= (v_hoy - v_gracia)::timestamptz)
    ), nx AS (
      SELECT e.*,
        CASE e.seg WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                   WHEN 'curso_31_90' THEN 'captacion-curso-3190'
                   WHEN 'vencida' THEN 'captacion-vencida' END AS venc_tpl,
        (SELECT count(*) FROM public.prospecto_mails pm WHERE pm.prospecto_id=e.id) AS n_mails
      FROM elig e
    ), nx2 AS (
      SELECT n.*,
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

  -- DGG-270: prioridad 7 (antes 8) — captación time-sensitive gana al backlog LexPH (8).
  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_p.tpl, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 7, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_p.tpl,
    'bucket', v_p.bucket, 'target', v_target, 'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $function$;