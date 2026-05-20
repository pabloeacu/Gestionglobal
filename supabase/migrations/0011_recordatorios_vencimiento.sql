-- ============================================================================
-- 0011_recordatorios_vencimiento · pg_cron + tabla de dedup para enviar
-- recordatorios automáticos de vencimiento de comprobantes (Phase 2A-2 chunk 3).
--
-- Lógica:
-- - Cada día, a las 09:00 AR (12:00 UTC), el cron dispara la edge function
--   `notify-vencimientos` vía pg_net.http_post.
-- - La edge function escanea comprobantes con saldo pendiente y vencimiento
--   en los umbrales {7, 3, 1} días por vencer o {1, 7} días vencidos.
-- - Para cada (comprobante_id, umbral) que aún no se notificó, envía email
--   vía SMTP Workspace e inserta en `comprobante_avisos_vencimiento`.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Tabla de dedup: PK compuesta evita duplicados.
-- umbral_dias positivo = falta para vencer; negativo = ya venció.
CREATE TABLE IF NOT EXISTS public.comprobante_avisos_vencimiento (
  comprobante_id uuid NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  umbral_dias int NOT NULL,
  enviado_at timestamptz NOT NULL DEFAULT now(),
  sent_email_id uuid REFERENCES public.sent_emails(id) ON DELETE SET NULL,
  PRIMARY KEY (comprobante_id, umbral_dias)
);

CREATE INDEX IF NOT EXISTS idx_avisos_vto_enviado
  ON public.comprobante_avisos_vencimiento(enviado_at DESC);

ALTER TABLE public.comprobante_avisos_vencimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avisos_select_staff ON public.comprobante_avisos_vencimiento;
CREATE POLICY avisos_select_staff ON public.comprobante_avisos_vencimiento
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS avisos_write_staff ON public.comprobante_avisos_vencimiento;
CREATE POLICY avisos_write_staff ON public.comprobante_avisos_vencimiento
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ----------------------------------------------------------------------------
-- View: comprobantes elegibles para notificación. Calcula dias_para_vto y
-- umbral redondeado al más cercano de los breakpoints {7, 3, 1, -1, -7}.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_comprobantes_para_avisar AS
SELECT
  c.id AS comprobante_id,
  c.administracion_id,
  c.consorcio_id,
  c.tipo,
  c.punto_venta,
  c.numero,
  c.fecha,
  c.vencimiento,
  c.total,
  c.saldo_pendiente,
  c.estado_cobranza,
  c.receptor_razon_social,
  (c.vencimiento - CURRENT_DATE)::int AS dias_para_vto
FROM public.comprobantes c
WHERE c.estado = 'autorizado'
  AND c.estado_cobranza IN ('pendiente','parcial','vencido')
  AND c.vencimiento IS NOT NULL
  AND c.saldo_pendiente > 0
  AND (c.vencimiento - CURRENT_DATE) BETWEEN -8 AND 8;

-- ----------------------------------------------------------------------------
-- Schedule: 12:00 UTC = 09:00 AR (UTC-3, no DST en Argentina).
-- La URL y el bearer secret se setean por separado via:
--   alter database postgres set "app.settings.notify_vencimientos_url" = '...';
--   alter database postgres set "app.settings.cron_secret" = '...';
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('notify-vencimientos-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'notify-vencimientos-diario'
);

SELECT cron.schedule(
  'notify-vencimientos-diario',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.notify_vencimientos_url', true),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
