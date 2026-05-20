-- ============================================================================
-- 0010_rpc_cobranzas · registrar pago de un comprobante (movimiento +
-- imputación atómicos). Phase 2A-2 chunk 2.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid,
  p_caja_id        uuid,
  p_fecha          date,
  p_monto          numeric,
  p_descripcion    text,
  p_referencia     text,
  p_categoria_id   uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede registrar cobranzas';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede cobrar un comprobante anulado';
  END IF;

  IF p_monto > v_comp.saldo_pendiente THEN
    RAISE EXCEPTION
      'El monto (%) supera el saldo pendiente (%) del comprobante',
      p_monto, v_comp.saldo_pendiente;
  END IF;

  -- Movimiento de ingreso (crea fila en cajas)
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, comprobante_id,
    estado, origen, created_by
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    NULLIF(trim(p_descripcion), ''), NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid()
  ) RETURNING id INTO v_mov_id;

  -- Imputación. El trigger trg_imp_recalcular_saldo actualiza
  -- saldo_pendiente y estado_cobranza del comprobante automáticamente.
  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, p_monto
  );

  RETURN v_mov_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- desimputar_cobranza · borra la imputación y, si el movimiento queda sin
-- imputaciones y se creó desde facturación, también borra el movimiento.
-- El trigger recalcula saldo_pendiente / estado_cobranza del comprobante.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desimputar_cobranza(
  p_imputacion_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp public.movimiento_imputaciones%ROWTYPE;
  v_mov public.movimientos%ROWTYPE;
  v_remaining int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede desimputar';
  END IF;

  SELECT * INTO v_imp FROM public.movimiento_imputaciones WHERE id = p_imputacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Imputación no encontrada';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = v_imp.movimiento_id;

  DELETE FROM public.movimiento_imputaciones WHERE id = p_imputacion_id;

  -- Si el movimiento se creó desde facturación y quedó sin imputaciones,
  -- borrarlo (evita huérfanos en cta cte).
  SELECT count(*) INTO v_remaining
  FROM public.movimiento_imputaciones WHERE movimiento_id = v_imp.movimiento_id;

  IF v_remaining = 0 AND v_mov.origen = 'facturacion' THEN
    DELETE FROM public.movimientos WHERE id = v_imp.movimiento_id;
  END IF;

  RETURN v_imp.comprobante_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.desimputar_cobranza(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desimputar_cobranza(uuid) TO authenticated;
