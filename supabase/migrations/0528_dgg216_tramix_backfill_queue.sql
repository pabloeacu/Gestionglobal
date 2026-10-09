-- 0528_dgg216_tramix_backfill_queue.sql
-- DGG-216 · Backfill de fechas regulatorias desde TRAMIX (Mesa de Entradas DPPJ-PBA).
-- Pablo: completar las fichas con fecha de matrícula + vencimiento reales, leídos
-- del legajo oficial, para habilitar una agenda regulatoria real (y recién ahí
-- encender el motor de ofrecimientos sobre datos ciertos).
--
-- Método validado con Pablo (pilotos Amado/Barraza/Berueta):
--   - matriculación inicial = expediente `ADMINISTRADOR DE CONSORCIOS` / INSCRIPTO.
--   - última renovación     = expediente `RENOVACION DE MATRICULA` / INSCRIPTO (el más reciente).
--   - vencimiento = (última renovación, o la matriculación si nunca renovó) + 12 meses.
--   - casos raros (sin matriculación, trámites de baja/suspensión, NOT_FOUND) → FLAG, no se inventan.
--
-- Arquitectura (goteo de fondo, respetuoso con el sitio gov frágil):
--   cola (esta tabla) + edge `tramix-backfill` (1 legajo/tick, reusa el flujo
--   TRAMIX probado) + pg_cron cada 1 min. El edge respeta el circuit-breaker
--   (tramix_throttle) y registra en tramix_record. NO se debilita ningún límite.

CREATE TABLE IF NOT EXISTS public.tramix_backfill_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  legajo         text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente',  -- pendiente|procesando|ok|flag|error
  intentos       int  NOT NULL DEFAULT 0,
  matriculacion  date,
  ultima_renovacion date,
  vencimiento    date,
  venc_anterior  date,                                -- snapshot del valor previo (audit)
  n_expedientes  int,
  flag           text,
  resultado      text,                                -- OK|NOT_FOUND|TIMEOUT|TRAMIX_DOWN|...
  titular        text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tramix_backfill_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tramix_backfill_queue TO authenticated;      -- monitoreo de gerencia
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tramix_backfill_queue TO service_role;  -- el edge
CREATE POLICY bf_staff_select ON public.tramix_backfill_queue
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE INDEX IF NOT EXISTS idx_bf_estado ON public.tramix_backfill_queue(estado, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bf_admin ON public.tramix_backfill_queue(admin_id);

-- Claim atómico de 1 legajo pendiente (o 'procesando' colgado > 5 min). SKIP LOCKED
-- para que varios ticks no pisen el mismo. Service-only.
CREATE OR REPLACE FUNCTION public.tramix_backfill_claim()
 RETURNS TABLE(id uuid, admin_id uuid, legajo text, venc_anterior date)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.tramix_backfill_queue q
     SET estado = 'procesando', updated_at = now()
   WHERE q.id = (
     SELECT q2.id FROM public.tramix_backfill_queue q2
      WHERE q2.estado = 'pendiente'
         OR (q2.estado = 'procesando' AND q2.updated_at < now() - interval '5 minutes')
      ORDER BY q2.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.admin_id, q.legajo, q.venc_anterior;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.tramix_backfill_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_backfill_claim() TO service_role;

-- Seed: los 105 con legajo cargado y SIN vencimiento aún (los 9 que ya tienen
-- vencimiento se dejan como están; se pueden re-verificar en una pasada aparte).
INSERT INTO public.tramix_backfill_queue (admin_id, legajo, venc_anterior)
SELECT a.id,
       regexp_replace(a.legajo_rpac, '[^0-9]', '', 'g'),
       a.matricula_rpac_vencimiento
FROM public.administraciones a
WHERE a.activo
  AND a.legajo_rpac IS NOT NULL AND trim(a.legajo_rpac) <> ''
  AND a.matricula_rpac_vencimiento IS NULL
ON CONFLICT (admin_id) DO NOTHING;
