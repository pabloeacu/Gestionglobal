-- 0530_dgg216_tramix_backfill_cron.sql
-- DGG-216 · Cron del goteo de fondo: cada 1 min invoca la edge `tramix-backfill`
-- (1 legajo/tick), SÓLO si quedan pendientes (guardia → cero llamadas inútiles
-- cuando la cola se vacía). ~2h para los 105. Hands-off.
-- NOTA: al terminar el backfill, desagendar con:
--   SELECT cron.unschedule('tramix-backfill-tick');
SELECT cron.schedule(
  'tramix-backfill-tick',
  '* * * * *',
  $cron$
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.tramix_backfill_queue
      WHERE estado = 'pendiente'
         OR (estado = 'procesando' AND updated_at < now() - interval '5 minutes')
    ) THEN
      PERFORM net.http_post(
        url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/tramix-backfill',
        headers := jsonb_build_object('Content-Type','application/json','Authorization', private.cron_bearer()),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    END IF;
  END $$;
  $cron$
);
