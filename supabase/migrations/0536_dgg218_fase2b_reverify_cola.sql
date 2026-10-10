-- 0536_dgg218_fase2b_reverify_cola.sql
-- DGG-218 · FASE 2B — Re-verificación TRAMIX del vencimiento declarado por el
-- cliente. Esta mig arma la COLA + el claim atómico + el trigger de encolado.
-- El edge `tramix-reverify` (que consume la cola) y la cron van aparte.
--
-- Flujo: cuando un cliente DECLARA su vencimiento (certeza='declarado') y tiene
-- legajo, se encola para re-verificar contra TRAMIX/DPPJ. El edge compara el
-- vencimiento oficial (interpret() del legajo) vs el declarado:
--   • coincide → la ficha sube a certeza='confirmado'/origen='verificado_tramix'.
--   • difiere  → se flaggea a gerencia (notify_all_gerentes), SIN pisar el dato
--                del cliente (gerencia decide).
-- Reusa la infra TRAMIX de DGG-216 (breaker, is_cron_token, goteo 1/tick) — NO
-- sube el cap ni hace queries masivas (método sancionado).
--
-- Reglas: R6 (GRANT authenticated), R11 (índice FK + estado), R17 (trigger de
-- encolado SECDEF: escribe la cola RLS sin policy de write para el invoker).

-- ───────────────────────────────────────────────────────────────────────────
-- A) COLA
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tramix_reverify_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  legajo          text NOT NULL,
  valor_declarado date NOT NULL,     -- el vencimiento que declaró el cliente (a comparar)
  estado          text NOT NULL DEFAULT 'pendiente',  -- pendiente|procesando|ok|discrepancia|flag|error
  intentos        int  NOT NULL DEFAULT 0,
  valor_oficial   date,              -- lo que computó TRAMIX (interpret)
  n_expedientes   int,
  flag            text,
  resultado       text,
  titular         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_reverify_admin UNIQUE (admin_id)   -- 1 pendiente por admin (ON CONFLICT lo refresca)
);

ALTER TABLE public.tramix_reverify_queue ENABLE ROW LEVEL SECURITY;
-- Staff ve la cola; service_role (edge/cron) la administra. El cliente NO escribe
-- (el encolado va por trigger SECDEF).
GRANT SELECT ON public.tramix_reverify_queue TO authenticated;
GRANT ALL ON public.tramix_reverify_queue TO service_role;
CREATE POLICY rv_staff_select ON public.tramix_reverify_queue FOR SELECT USING (private.is_staff());

CREATE INDEX IF NOT EXISTS ix_reverify_estado ON public.tramix_reverify_queue (estado);

-- ───────────────────────────────────────────────────────────────────────────
-- B) CLAIM atómico (espejo de tramix_backfill_claim)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tramix_reverify_claim()
 RETURNS TABLE(id uuid, admin_id uuid, legajo text, valor_declarado date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.tramix_reverify_queue q
     SET estado = 'procesando', updated_at = now()
   WHERE q.id = (
     SELECT q2.id FROM public.tramix_reverify_queue q2
      WHERE q2.estado = 'pendiente'
         OR (q2.estado = 'procesando' AND q2.updated_at < now() - interval '5 minutes')
      ORDER BY q2.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.admin_id, q.legajo, q.valor_declarado;
END $function$;

REVOKE ALL ON FUNCTION public.tramix_reverify_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_reverify_claim() TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- C) TRIGGER de encolado — cuando el vencimiento queda DECLARADO por el cliente
--    y hay legajo, (re)encola para re-verificar. DRY: cubre RPC portal + sync
--    landing sin re-emitirlos. SECDEF para escribir la cola RLS (R17).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverify_enqueue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.tramix_reverify_queue (admin_id, legajo, valor_declarado, estado, intentos)
  VALUES (NEW.id, NEW.legajo_rpac, NEW.matricula_rpac_vencimiento, 'pendiente', 0)
  ON CONFLICT (admin_id) DO UPDATE SET
    legajo          = EXCLUDED.legajo,
    valor_declarado = EXCLUDED.valor_declarado,
    estado          = 'pendiente',
    intentos        = 0,
    valor_oficial   = NULL,
    flag            = NULL,
    resultado       = NULL,
    updated_at      = now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_reverify_enqueue ON public.administraciones;
CREATE TRIGGER trg_reverify_enqueue
  AFTER UPDATE ON public.administraciones
  FOR EACH ROW
  WHEN (NEW.matricula_rpac_vencimiento_certeza = 'declarado'
        AND NEW.legajo_rpac IS NOT NULL
        AND NEW.matricula_rpac_vencimiento IS NOT NULL
        AND (NEW.matricula_rpac_vencimiento_certeza IS DISTINCT FROM OLD.matricula_rpac_vencimiento_certeza
             OR NEW.matricula_rpac_vencimiento IS DISTINCT FROM OLD.matricula_rpac_vencimiento))
  EXECUTE FUNCTION public.reverify_enqueue();
