-- 0564_dgg222_f4_cron_diario.sql
-- =============================================================================
-- DGG-222 · Cron diario del equipo de cierre de trámites.
-- 10:00 ART = 13:00 UTC (convención del repo: 09:00 AR = 12:00 UTC). Server-side
-- (pg_cron) → corre con la compu de Pablo apagada. Llama agente_cierre_correr('cron')
-- directo (el GUC de tenencia lo habilita correr para los avisos al cliente en el
-- path cron/postgres). Cierra en modo real SÓLO si config_global.agente_cierre_activo
-- = true; capado por agente_cierre_cap. Idempotente (no re-cierra los ya cerrados).
-- =============================================================================
SELECT cron.unschedule('agente-cierre-tramites-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agente-cierre-tramites-diario');

SELECT cron.schedule('agente-cierre-tramites-diario', '0 13 * * *',
  $cron$ SELECT public.agente_cierre_correr('cron'); $cron$);
