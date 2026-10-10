-- 0537_dgg218_fase2b_reverify_cron.sql
-- DGG-218 · FASE 2B · Cron del goteo de re-verificación: cada 1 min invoca la
-- edge `tramix-reverify` (1 legajo/tick), SÓLO si quedan pendientes en la cola
-- (guardia → cero llamadas inútiles cuando la cola está vacía). Hands-off,
-- respeta el circuit-breaker (tramix_throttle) y el ritmo suave con el sitio gov.
--
-- A diferencia del backfill (DGG-216, cron de una sola pasada ya desagendada),
-- esta cron queda PERMANENTE: la cola se llena event-driven cuando un cliente
-- declara su vencimiento (trigger trg_reverify_enqueue). Hoy la cola está vacía
-- (0 declarados) → la cron es no-op hasta que empiecen a llegar declaraciones.
--
-- PAUSAR: SELECT cron.unschedule('tramix-reverify-tick');
SELECT cron.schedule(
  'tramix-reverify-tick',
  '* * * * *',
  $cron$
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.tramix_reverify_queue
      WHERE estado = 'pendiente'
         OR (estado = 'procesando' AND updated_at < now() - interval '5 minutes')
    ) THEN
      PERFORM net.http_post(
        url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/tramix-reverify',
        headers := jsonb_build_object('Content-Type','application/json','Authorization', private.cron_bearer()),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    END IF;
  END $$;
  $cron$
);
