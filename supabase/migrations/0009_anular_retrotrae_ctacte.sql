-- ============================================================================
-- 0009_anular_retrotrae_ctacte · al anular un comprobante, las imputaciones
-- de cobranza se borran. El trigger trg_imp_recalcular_saldo recalcula
-- saldo_pendiente y estado_cobranza por cada DELETE; al finalizar, el
-- comprobante queda con estado='anulado'/estado_cobranza='anulado'/saldo=0.
-- Los movimientos involucrados conservan su monto; lo que cambia es la suma
-- de imputaciones (que ahora omite las borradas) → quedan con saldo
-- disponible para re-imputar a otro comprobante.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anular_comprobante(
  p_comprobante_id uuid,
  p_motivo text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede anular comprobantes';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante ya está anulado';
  END IF;

  -- Con CAE no se puede anular: regla D08/D09 — emitir NC.
  IF v_comp.cae IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede anular un comprobante con CAE (%). Emití una nota de crédito.', v_comp.cae;
  END IF;

  -- Borrar imputaciones: el trigger trg_imp_recalcular_saldo recalcula
  -- saldo_pendiente y estado_cobranza por cada DELETE. Los movimientos
  -- quedan con su saldo disponible re-imputable.
  DELETE FROM public.movimiento_imputaciones
  WHERE comprobante_id = p_comprobante_id;

  -- Marcar anulado. Forzamos saldo_pendiente=0 y estado_cobranza='anulado'
  -- (aunque el trigger ya los habría dejado consistentes).
  UPDATE public.comprobantes SET
    estado = 'anulado',
    estado_cobranza = 'anulado',
    saldo_pendiente = 0,
    motivo_rechazo = COALESCE(NULLIF(trim(p_motivo), ''), 'Anulación manual')
  WHERE id = p_comprobante_id;

  RETURN p_comprobante_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anular_comprobante(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_comprobante(uuid, text) TO authenticated;
