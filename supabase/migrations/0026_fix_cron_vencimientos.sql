-- 0026 · Fix cron dispatch-vencimientos
-- =============================================================================
-- La migración 0025 dejaba el cron de dispatch-vencimientos dependiendo de
-- `ALTER DATABASE postgres SET app.settings.dispatch_vencimientos_url = ...`,
-- operación que requiere superuser (no disponible vía MCP). Mismo problema con
-- `app.settings.cron_secret`.
--
-- Esta migración:
--   1. Re-agenda el cron con la URL hardcoded (no es secreto) + auth con el
--      `app.service_role_key` que Supabase ya preset automáticamente
--      (mismo patrón que dispatch-emails-1min de la migración 0024).
--   2. Elimina la necesidad de configuración humana en el dashboard.
--
-- La edge function `dispatch-vencimientos` se actualiza en paralelo para
-- aceptar el service_role_key como bearer (además del CRON_SECRET legacy).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-vencimientos-diario') THEN
    PERFORM cron.unschedule('dispatch-vencimientos-diario');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-vencimientos-diario',
  '0 12 * * *',  -- 09:00 AR (12:00 UTC)
  $cron$
    SELECT net.http_post(
      url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-vencimientos',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
