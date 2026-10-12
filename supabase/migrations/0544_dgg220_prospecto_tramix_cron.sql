-- 0544_dgg220_prospecto_tramix_cron.sql
-- =============================================================================
-- DGG-220 · Fase 1c — Cron del goteo de enriquecimiento de prospectos: cada 1 min
-- invoca `tramix-prospectos` (1 legajo/tick), SÓLO si quedan pendientes.
-- ~N minutos para N legajos (~1,8 días para ~2575). Hands-off, respeta el breaker.
-- Pace sancionado DGG-216: 1/min, único consumidor activo, sin subir cap.
-- (La cron de reverify está agendada pero su cola está vacía → no-op; el único
--  consumidor real que golpea TRAMIX es éste mientras drena.)
-- NOTA: al terminar, desagendar con: SELECT cron.unschedule('tramix-prospectos-tick');
-- =============================================================================
SELECT cron.schedule(
  'tramix-prospectos-tick',
  '* * * * *',
  $cron$
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.prospecto_tramix_queue
      WHERE estado = 'pendiente'
         OR (estado = 'procesando' AND updated_at < now() - interval '5 minutes')
    ) THEN
      PERFORM net.http_post(
        url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/tramix-prospectos',
        headers := jsonb_build_object('Content-Type','application/json','Authorization', private.cron_bearer()),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    END IF;
  END $$;
  $cron$
);
