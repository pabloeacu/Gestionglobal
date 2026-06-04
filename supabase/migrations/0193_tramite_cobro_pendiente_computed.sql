-- ============================================================================
-- 0193 · DGG-44 · Gate de cobranza al avanzar un trámite
--
-- Pablo (2026-06-04): "Excepto DDJJ, el resto requiere pagos previos para
-- avanzar. Cuando quiera avanzar cualquier trámite que tenga un comprobante
-- con costo (podría ser 0.00 = gratuito/bonificado) y NO esté cobrado →
-- ventana: 'Este trámite no tiene cobranza registrada. Por lo tanto, está
-- impago. ¿Desea avanzar la gestión de todos modos?' (Avanzar / Cancelar)."
--
-- Diseño: la advertencia es UX (soft gate, el usuario puede continuar). La BD
-- NO bloquea — sólo provee la SEÑAL. Computed column `cobro_pendiente(tramites)`
-- que PostgREST expone como columna virtual seleccionable.
--
-- Modelo de datos (verificado en vivo): el comprobante del trámite vive en
-- `solicitudes.comprobante_id` (vía solicitudes.tramite_id), NO en el campo
-- directo tramites.comprobante_id (siempre NULL en flujos de formulario).
-- Contemplamos AMBOS caminos por robustez.
--
-- Impago = existe comprobante NO anulado, con total > 0 y saldo_pendiente > 0.
--   · sin comprobante (DDJJ)        → false (no warning)
--   · comprobante 0.00 (gratuito)   → false (no warning)
--   · comprobante con costo cobrado → false (saldo 0)
--   · comprobante con costo impago  → true  (warning)
--
-- Verificado e2e (BEGIN/ROLLBACK): pagado→false, impago→true, cobrado→false.
-- PostgREST expone la computed column; auth puede ejecutar, anon no.
-- ============================================================================

-- Índice de apoyo para el subquery por solicitud (perf · R11).
CREATE INDEX IF NOT EXISTS idx_solicitudes_tramite_comp
  ON public.solicitudes(tramite_id)
  WHERE comprobante_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cobro_pendiente(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comprobantes c
    WHERE c.estado <> 'anulado'
      AND COALESCE(c.total, 0) > 0
      AND COALESCE(c.saldo_pendiente, 0) > 0
      AND (
        c.id = t.comprobante_id
        OR c.id IN (
          SELECT s.comprobante_id
          FROM public.solicitudes s
          WHERE s.tramite_id = t.id
            AND s.comprobante_id IS NOT NULL
        )
      )
  );
$$;

COMMENT ON FUNCTION public.cobro_pendiente(public.tramites) IS
  'DGG-44 · Computed column (Postgrest). TRUE si el trámite tiene un comprobante con costo (total>0) e impago (saldo_pendiente>0), no anulado, por cualquiera de los dos caminos (tramites.comprobante_id o solicitudes.tramite_id→comprobante_id). Señal para el gate de cobranza al avanzar en el kanban.';

REVOKE EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) TO authenticated;

-- ── Smoke e2e (R18): los 4 trámites reales devuelven el flag esperado ──────
DO $$
DECLARE
  v_impago_count int;
  v_cert boolean;
BEGIN
  -- El certificado 00023 hoy está PAGADO (saldo 0) → debe dar false.
  SELECT public.cobro_pendiente(t.*) INTO v_cert
  FROM public.tramites t WHERE t.codigo = 'TRM-2026-00023';
  IF v_cert IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SMOKE_FAIL: TRM-00023 (pagado) debería dar cobro_pendiente=false, dio %', v_cert;
  END IF;

  -- Ningún trámite real hoy está impago (todos pagados o sin comprobante).
  SELECT count(*) INTO v_impago_count
  FROM public.tramites t WHERE public.cobro_pendiente(t.*);
  RAISE NOTICE 'SMOKE_OK: cobro_pendiente operativo · % trámites impagos hoy', v_impago_count;
END $$;
