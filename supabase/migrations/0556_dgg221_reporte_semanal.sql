-- 0556_dgg221_reporte_semanal.sql
-- =============================================================================
-- DGG-221 · Reporte semanal del motor de captación (valor agregado pedido por Pablo).
-- Lo corre un cron semanal → calcula métricas y avisa a gerencia (campanita + push +
-- email) con el avance: enviados, conversiones, rebotes, elegibles restantes.
-- Service-role only (lo invoca el cron).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prospectos_reporte_semanal()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_env_7d int; v_conv_total int; v_conv_7d int; v_bajas int;
  v_contactados int; v_sin_contactar int; v_cola int;
  v_reb_total int; v_reb_bad int; v_reb_pct numeric;
  v_activo boolean; v_pausado boolean; v_cuerpo text;
BEGIN
  SELECT count(*) INTO v_env_7d FROM public.prospecto_mails WHERE enviado_at >= now() - interval '7 days';
  SELECT count(*) INTO v_conv_total FROM public.prospectos WHERE origen='padron_pba' AND convertido_at IS NOT NULL;
  SELECT count(*) INTO v_conv_7d FROM public.prospectos WHERE origen='padron_pba' AND convertido_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas FROM public.prospectos WHERE origen='padron_pba' AND baja_at IS NOT NULL;
  SELECT count(*) INTO v_contactados FROM public.prospectos WHERE origen='padron_pba' AND ultimo_mail_at IS NOT NULL;
  SELECT count(*) INTO v_sin_contactar FROM public.prospectos
    WHERE origen='padron_pba' AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid' AND ultimo_mail_at IS NULL;
  SELECT count(*) INTO v_cola FROM public.email_queue WHERE related_table='prospectos' AND enviado_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_reb_total, v_reb_bad FROM public.sent_emails
    WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  v_reb_pct := CASE WHEN v_reb_total > 0 THEN round(v_reb_bad::numeric/v_reb_total*100, 1) ELSE 0 END;
  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false)
    INTO v_activo, v_pausado FROM public.config_global LIMIT 1;

  v_cuerpo := format(
    'Semana de captación: %s mails enviados · %s conversiones nuevas (%s en total) · rebotes/quejas %s%% (%s/%s). Faltan contactar %s · en cola %s. Motor: %s%s.',
    v_env_7d, v_conv_7d, v_conv_total, v_reb_pct, v_reb_bad, v_reb_total, v_sin_contactar, v_cola,
    CASE WHEN v_activo THEN 'activo' ELSE 'apagado' END,
    CASE WHEN v_pausado THEN ' (auto-pausado por reputación)' ELSE '' END);

  PERFORM public.notify_all_gerentes(
    'prospectos_reporte_semanal', 'Reporte semanal · Captación PBA', v_cuerpo,
    '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, true);

  RETURN jsonb_build_object(
    'enviados_7d', v_env_7d, 'conversiones_7d', v_conv_7d, 'conversiones_total', v_conv_total,
    'bajas', v_bajas, 'contactados', v_contactados, 'sin_contactar', v_sin_contactar, 'cola', v_cola,
    'rebotes_pct', v_reb_pct, 'rebotes', v_reb_bad, 'enviados_medidos', v_reb_total,
    'motor_activo', v_activo, 'motor_pausado', v_pausado);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_reporte_semanal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospectos_reporte_semanal() TO service_role;
