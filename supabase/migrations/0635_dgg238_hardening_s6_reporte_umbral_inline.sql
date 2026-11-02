-- 0635_dgg238_hardening_s6_reporte_umbral_inline.sql
-- =============================================================================
-- DGG-238 · HARDENING §6 — fix menor de la doble auditoría (3 agentes) del chunk
-- de cierre de pendientes (deep-link de engagement + coherencia del reporte).
--
--  C#7 (Agente C): el titular de reputación del reporte semanal mostraba "X%"
--     sin anclar el umbral inline, mientras el chip del panel sí muestra
--     "X% / 5% umbral". Un gerente que lee la campanita veía el número sin
--     referencia (salvo el sufijo "(auto-pausado…)" que sólo aparece si YA está
--     pausado). Fix cosmético de paridad de display: el titular concluyente pasa
--     a "X% (umbral 5%)". El '%' viaja como DATO dentro de `v_rep_txt`
--     (`||'% (umbral 5%)'`), no como spec de format() — format() no re-escanea
--     valores sustituidos por `%s`.
--
-- Único cambio vs 0634: la línea de `v_rep_txt`. Todo lo demás es idéntico.
-- Reglas: R16 (CREATE OR REPLACE, firma idéntica — 1 overload), R17 (SECDEF +
-- search_path), R19. Service-role only (cron 'prospectos-reporte-semanal').
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prospectos_reporte_semanal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_env_7d int; v_conv_total int; v_conv_7d int; v_bajas_7d int; v_bajas_total int;
  v_contactados int; v_sin_contactar int; v_cola int;
  v_reb_total int; v_reb_rebotes int; v_reb_quejas int; v_reb_pct numeric;
  v_rep_bad int; v_rep_pct numeric; v_rep_txt text;
  v_nuevos_7d int; v_sembr_7d int; v_sembr_total int;
  v_activo boolean; v_pausado boolean; v_cuerpo text;
BEGIN
  SELECT count(*) INTO v_env_7d FROM public.prospecto_mails WHERE enviado_at >= now() - interval '7 days';
  SELECT count(*) INTO v_conv_total FROM public.prospectos WHERE origen='padron_pba' AND convertido_at IS NOT NULL;
  SELECT count(*) INTO v_conv_7d FROM public.prospectos WHERE origen='padron_pba' AND convertido_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas_7d FROM public.prospectos WHERE origen='padron_pba' AND baja_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas_total FROM public.prospectos WHERE origen='padron_pba' AND baja_at IS NOT NULL;
  SELECT count(*) INTO v_contactados FROM public.prospectos WHERE origen='padron_pba' AND ultimo_mail_at IS NOT NULL;
  SELECT count(*) INTO v_sin_contactar FROM public.prospectos
    WHERE origen='padron_pba' AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid' AND ultimo_mail_at IS NULL;
  SELECT count(*) INTO v_cola FROM public.email_queue WHERE related_table='prospectos' AND enviado_at IS NULL;

  SELECT count(*),
         count(*) FILTER (WHERE estado='bounced'),
         count(*) FILTER (WHERE estado='complained')
    INTO v_reb_total, v_reb_rebotes, v_reb_quejas
    FROM public.sent_emails
    WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  v_reb_pct := CASE WHEN v_reb_total > 0 THEN round(v_reb_rebotes::numeric/v_reb_total*100, 1) ELSE 0 END;
  v_rep_bad := v_reb_rebotes + v_reb_quejas;
  v_rep_pct := CASE WHEN v_reb_total > 0 THEN round(v_rep_bad::numeric/v_reb_total*100, 1) ELSE 0 END;
  -- DGG-238 §6 (C#7) · "(umbral 5%)" inline para paridad de display con el chip.
  v_rep_txt := CASE WHEN v_reb_total >= 20 THEN v_rep_pct::text || '% (umbral 5%)' ELSE 'muestra chica (<20 env.)' END;

  SELECT count(*) INTO v_nuevos_7d
    FROM public.prospectos WHERE origen='padron_pba' AND created_at >= now() - interval '7 days';

  SELECT count(*) INTO v_sembr_7d FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at AND pm.template_slug LIKE 'captacion-%');
  SELECT count(*) INTO v_sembr_total FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at AND pm.template_slug LIKE 'captacion-%');

  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false)
    INTO v_activo, v_pausado FROM public.config_global LIMIT 1;

  v_cuerpo := format(
    'Semana de captación: %s mails enviados · %s nuevos matriculados incorporados al padrón · conversiones %s nuevas (%s total), sembradas por campaña %s (%s total). Reputación (7d): %s · %s rebotes · %s quejas de spam · %s bajas voluntarias. Faltan contactar %s · en cola %s. Motor: %s%s.',
    v_env_7d, v_nuevos_7d, v_conv_7d, v_conv_total, v_sembr_7d, v_sembr_total,
    v_rep_txt, v_reb_rebotes, v_reb_quejas, v_bajas_7d,
    v_sin_contactar, v_cola,
    CASE WHEN v_activo THEN 'activo' ELSE 'apagado' END,
    CASE WHEN v_pausado THEN ' (auto-pausado por reputación)' ELSE '' END);

  PERFORM public.notify_all_gerentes(
    'prospectos_reporte_semanal', 'Reporte semanal · Captación PBA', v_cuerpo,
    '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, true);

  RETURN jsonb_build_object(
    'enviados_7d', v_env_7d, 'nuevos_padron_7d', v_nuevos_7d,
    'conversiones_7d', v_conv_7d, 'conversiones_total', v_conv_total,
    'conversiones_sembradas_7d', v_sembr_7d, 'conversiones_sembradas_total', v_sembr_total,
    'bajas_7d', v_bajas_7d, 'bajas_total', v_bajas_total,
    'contactados', v_contactados, 'sin_contactar', v_sin_contactar, 'cola', v_cola,
    'rebotes', v_reb_rebotes, 'quejas_spam', v_reb_quejas, 'rebotes_pct', v_reb_pct,
    'reputacion_pct', v_rep_pct, 'reputacion_bad', v_rep_bad,
    'reputacion_muestra_chica', (v_reb_total < 20),
    'enviados_medidos', v_reb_total, 'motor_activo', v_activo, 'motor_pausado', v_pausado);
END $function$;
