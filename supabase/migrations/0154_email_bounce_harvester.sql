-- ============================================================================
-- Mig 0154 · D2-bis · Bounce/Reply harvester
--
-- En vez de pixel tracking (que afecta deliverability), un cron lee la
-- bandeja de contacto@gestionglobal.ar vía Gmail OAuth, detecta DSN
-- (Delivery Status Notification) y actualiza el estado de sent_emails.
--
-- Cambios:
--   1. Columna `dsn_msg_id` en sent_emails para deduplicar (no procesar
--      el mismo bounce 2 veces aunque vuelva a aparecer).
--   2. Índice (to_email, enviado_at DESC) para matchear rápido.
--   3. Cron `gg-email-bounces-30min` que llama a la edge function
--      `email-bounce-harvester` cada 30 minutos.
-- ============================================================================

ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS dsn_msg_id text UNIQUE;

COMMENT ON COLUMN public.sent_emails.dsn_msg_id IS
  'Gmail message-id del DSN (Delivery Status Notification) procesado. '
  'Sirve para deduplicar: si el bounce ya está procesado, su gmail msg_id '
  'queda acá. Mig 0154 / D2-bis.';

CREATE INDEX IF NOT EXISTS idx_sent_emails_to_email_enviado_at
  ON public.sent_emails (to_email, enviado_at DESC);

-- Cron: cada 30 min.
SELECT cron.unschedule('gg-email-bounces-30min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-email-bounces-30min');

SELECT cron.schedule(
  'gg-email-bounces-30min',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/email-bounce-harvester',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);