-- 0543_dgg220_prospecto_tramix_queue.sql
-- =============================================================================
-- DGG-220 · Fase 1c — Cola de enriquecimiento TRAMIX para PROSPECTOS.
-- Clon del patrón de DGG-216 (tramix_backfill_queue), pero el destino es
-- `prospecto_padron` (una fila por matriculado-persona), no `administraciones`.
-- El edge `tramix-prospectos` (clon de `tramix-backfill`) consume 1 legajo/tick
-- por cron, respeta el breaker (tramix_throttle) y el pace sancionado (DGG-216):
-- 1/min, único consumidor, sin subir cap, sin tramix_gate.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.prospecto_tramix_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  padron_id      uuid NOT NULL REFERENCES public.prospecto_padron(id) ON DELETE CASCADE,
  legajo         text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente',  -- pendiente|procesando|ok|flag|error
  intentos       int  NOT NULL DEFAULT 0,
  matriculacion  date,
  ultima_renovacion date,
  vencimiento    date,
  n_expedientes  int,
  flag           text,
  resultado      text,
  titular        text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prospecto_tramix_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.prospecto_tramix_queue TO authenticated;      -- monitoreo gerencia
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospecto_tramix_queue TO service_role;  -- el edge

DROP POLICY IF EXISTS ptx_staff_select ON public.prospecto_tramix_queue;
CREATE POLICY ptx_staff_select ON public.prospecto_tramix_queue
  FOR SELECT TO authenticated USING (private.is_staff());

CREATE INDEX IF NOT EXISTS idx_ptx_estado ON public.prospecto_tramix_queue(estado, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptx_padron ON public.prospecto_tramix_queue(padron_id);

-- Claim atómico de 1 legajo pendiente (o 'procesando' colgado > 5 min). SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.prospecto_tramix_claim()
 RETURNS TABLE(id uuid, padron_id uuid, legajo text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.prospecto_tramix_queue q
     SET estado = 'procesando', updated_at = now()
   WHERE q.id = (
     SELECT q2.id FROM public.prospecto_tramix_queue q2
      WHERE q2.estado = 'pendiente'
         OR (q2.estado = 'procesando' AND q2.updated_at < now() - interval '5 minutes')
      ORDER BY q2.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.padron_id, q.legajo;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.prospecto_tramix_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecto_tramix_claim() TO service_role;
