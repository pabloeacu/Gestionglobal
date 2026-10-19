-- 0590_dgg226_queue_motivo_y_planner_scope.sql
-- DGG-226 · BLINDAJE DEL AVISO DE VENCIMIENTO (pedido de Pablo: "re-verificá
-- contra TRAMIX antes del aviso; si no está vencida, no mandes el mail y
-- actualizá su ficha"). Capitaliza el caso Monica (E-GG-44): el aviso de
-- "matrícula vencida" del motor de ofrecimientos salía sobre la fecha de la
-- ficha SIN re-chequear TRAMIX al momento del envío.
--
-- Esta mig (1/3) prepara la COLA compartida `tramix_cierre_refresh_queue` para
-- que el motor de ofrecimientos pueda encolar scrapeos de verificación de
-- vencimiento SIN que el planner del agente de cierre se los borre.
--
-- Problema concreto: `agente_cierre_planificar()` arranca con
-- `DELETE FROM tramix_cierre_refresh_queue;` (TODA la tabla). El motor corre
-- 9:00 ART y encola filas de vencimiento; el planner corre 10:00 ART y las
-- barría antes de que el worker (10:05-15:55) las scrapeara. Fix: columna
-- `motivo` ('cierre'|'vencimiento') + DELETE acotado a motivo='cierre'.
--
-- Reglas: R6 (no crea tabla, sólo ALTER — GRANTs ya existen), R16 (DROP+CREATE
-- no aplica: no cambia firma), R17 (planner ya es SECDEF).

-- ───────────────────────────────────────────────────────────────────────────
-- A) Columna motivo en la cola compartida
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tramix_cierre_refresh_queue
  ADD COLUMN IF NOT EXISTS motivo text NOT NULL DEFAULT 'cierre';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tramix_cierre_refresh_queue_motivo_chk'
  ) THEN
    ALTER TABLE public.tramix_cierre_refresh_queue
      ADD CONSTRAINT tramix_cierre_refresh_queue_motivo_chk
      CHECK (motivo IN ('cierre','vencimiento'));
  END IF;
END $$;

-- índice para el claim/planner por estado+motivo (R11)
CREATE INDEX IF NOT EXISTS ix_cierre_refresh_estado_motivo
  ON public.tramix_cierre_refresh_queue (estado, motivo);

-- ───────────────────────────────────────────────────────────────────────────
-- B) Planner del agente de cierre — DELETE acotado a motivo='cierre'
--    (ÚNICO cambio vs la versión previa: el WHERE del DELETE). El resto es
--    verbatim para no introducir drift.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agente_cierre_planificar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- DGG-226: sólo borra lo que ESTE planner gestiona (cierre). Las filas de
  -- motivo='vencimiento' que encola el motor de ofrecimientos NO se tocan.
  DELETE FROM public.tramix_cierre_refresh_queue WHERE motivo = 'cierre';

  INSERT INTO public.tramix_cierre_refresh_queue (legajo, admin_id, run_date, motivo)
  SELECT DISTINCT ON (regexp_replace(e->>'legajo', '[^0-9]', '', 'g'))
         regexp_replace(e->>'legajo', '[^0-9]', '', 'g') AS legajo,
         (e->>'administracion_id')::uuid,
         (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
         'cierre'
  FROM jsonb_array_elements(private.agente_cierre_detectar()) e
  WHERE e->>'track' = 'principal'
    AND e->>'decision' <> 'reportar_bloqueo'
    AND COALESCE(regexp_replace(e->>'legajo', '[^0-9]', '', 'g'), '') <> ''
  ON CONFLICT (legajo) DO UPDATE
     SET estado = 'pendiente', intentos = 0, run_date = EXCLUDED.run_date,
         motivo = 'cierre', updated_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'encolados', v_n);
END $function$;
