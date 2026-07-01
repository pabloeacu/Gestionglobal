-- ============================================================================
-- 0265_saldo_a_favor_imputar_credito.sql
-- DGG-91 (reporte JL #3) · Cuando se anula un comprobante YA PAGADO (p. ej. una
-- inscripción duplicada), el pago queda como un INGRESO sin imputar = saldo a
-- favor del cliente, pero era invisible y no había forma de aplicarlo a otra
-- deuda. Este chunk expone ese crédito y permite imputarlo a otro comprobante
-- pendiente de la MISMA administración.
--
-- Modelo (ya existente): movimientos (ingreso) + movimiento_imputaciones (N por
-- movimiento, cada una a UN destino). El destino es XOR: comprobante_id XOR
-- administracion_id (chk_imp_destino_xor). Para aplicar a un comprobante puntual
-- se setea comprobante_id y administracion_id DEBE ir NULL. El trigger
-- trg_imp_recalcular_saldo baja el saldo del comprobante destino; el trigger
-- trg_imp_validar_sum_no_supera_monto impide que Σ imputaciones supere el
-- monto del ingreso. Sin DDL: sólo 2 RPCs de lectura/escritura.
--
-- E-GG-XX (e2e §6): el smoke sintético detectó que la 1ª versión seteaba
-- administracion_id en la imputación a comprobante → violaba chk_imp_destino_xor.
-- Fix: administracion_id = NULL cuando el destino es un comprobante.
-- ============================================================================

-- (A) Listar los saldos a favor disponibles de una administración
CREATE OR REPLACE FUNCTION public.listar_creditos_administracion(p_administracion_id uuid)
 RETURNS TABLE(movimiento_id uuid, fecha date, monto numeric, saldo_disponible numeric, descripcion text, comprobante_origen text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.fecha, m.monto,
         m.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                              WHERE mi.movimiento_id = m.id), 0) AS saldo_disponible,
         m.descripcion,
         (SELECT c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0') || '-' || lpad(c.numero::text, 8, '0')
            FROM public.comprobantes c WHERE c.id = m.comprobante_id) AS comprobante_origen
    FROM public.movimientos m
   WHERE m.administracion_id = p_administracion_id
     AND m.tipo = 'ingreso'
     AND m.estado = 'identificado'
     AND m.revertido_at IS NULL
     AND m.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                              WHERE mi.movimiento_id = m.id), 0) > 0
   ORDER BY m.fecha DESC;
END;
$function$;

-- (B) Imputar un crédito (ingreso disponible) a un comprobante pendiente
CREATE OR REPLACE FUNCTION public.imputar_credito_a_comprobante(p_movimiento_id uuid, p_comprobante_id uuid, p_monto numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_mov public.movimientos%ROWTYPE;
  v_comp public.comprobantes%ROWTYPE;
  v_saldo_credito numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor no existe'; END IF;
  IF v_mov.tipo <> 'ingreso' OR v_mov.estado <> 'identificado' OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento no es un ingreso disponible';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El comprobante no existe'; END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'El comprobante está anulado'; END IF;
  IF COALESCE(v_comp.saldo_pendiente, 0) <= 0 THEN RAISE EXCEPTION 'El comprobante no tiene saldo pendiente'; END IF;

  IF v_mov.administracion_id IS DISTINCT FROM v_comp.administracion_id THEN
    RAISE EXCEPTION 'El saldo a favor y el comprobante pertenecen a administraciones distintas';
  END IF;

  v_saldo_credito := v_mov.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                                              WHERE mi.movimiento_id = p_movimiento_id), 0);
  IF v_saldo_credito <= 0 THEN RAISE EXCEPTION 'Ese saldo a favor ya fue aplicado'; END IF;
  IF p_monto > v_saldo_credito THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo a favor disponible (%)', p_monto, v_saldo_credito;
  END IF;
  IF p_monto > v_comp.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo del comprobante (%)', p_monto, v_comp.saldo_pendiente;
  END IF;

  -- destino = comprobante ⇒ administracion_id DEBE ir NULL (chk_imp_destino_xor: comprobante_id XOR administracion_id)
  INSERT INTO public.movimiento_imputaciones
    (movimiento_id, comprobante_id, administracion_id, monto_imputado, nota, created_by)
  VALUES (p_movimiento_id, p_comprobante_id, NULL, p_monto,
          'Saldo a favor aplicado (crédito por anulación/pago a cuenta)', v_user);
  -- el trigger trg_imp_recalcular_saldo recalcula el saldo del comprobante destino

  RETURN jsonb_build_object('ok', true,
    'credito_restante', v_saldo_credito - p_monto,
    'comprobante_saldo', (SELECT saldo_pendiente FROM public.comprobantes WHERE id = p_comprobante_id));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.listar_creditos_administracion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.imputar_credito_a_comprobante(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_creditos_administracion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imputar_credito_a_comprobante(uuid, uuid, numeric) TO authenticated;
