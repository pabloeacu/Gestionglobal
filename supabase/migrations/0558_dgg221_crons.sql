-- 0558_dgg221_crons.sql
-- =============================================================================
-- DGG-221 · Agenda de crons del motor de captación (server-side, anda con la
-- compu de Pablo apagada). Los crons son SEGUROS de agendar aunque el flag esté
-- OFF: el tick hace no-op mientras `prospectos_campanas_activo=false`. La
-- activación real = prender ese flag (paso operativo aparte).
--   · tick cada 20 min → prospectos_campana_tick() (encola 1 si corresponde).
--   · re-import ~cada 10 días (días 1/11/21) → edge prospectos-reimport-padron.
--   · reporte semanal (lunes) → prospectos_reporte_semanal().
-- =============================================================================

SELECT cron.unschedule('prospectos-campanas-tick')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='prospectos-campanas-tick');
SELECT cron.unschedule('prospectos-reimport-10d')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='prospectos-reimport-10d');
SELECT cron.unschedule('prospectos-reporte-semanal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='prospectos-reporte-semanal');

SELECT cron.schedule('prospectos-campanas-tick', '*/20 * * * *', $$ SELECT public.prospectos_campana_tick(); $$);

SELECT cron.schedule('prospectos-reimport-10d', '0 9 1,11,21 * *', $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/prospectos-reimport-padron',
    headers := jsonb_build_object('Content-Type','application/json','Authorization', private.cron_bearer()),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$cron$);

SELECT cron.schedule('prospectos-reporte-semanal', '0 12 * * 1', $$ SELECT public.prospectos_reporte_semanal(); $$);
