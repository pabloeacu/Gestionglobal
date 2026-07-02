-- DGG-95 §6 hardening: guardia NaN/NULL en el monto de cobranza.
-- `p_monto <= 0` no atrapa NaN (NaN <= 0 = false). `NOT (p_monto > 0)` sí (NaN > 0 = false).
-- Teórico (el input del browser no produce NaN y round2/registrarCobranzaEnEmision ya
-- filtran), pero cierra el hueco de raíz — defensa en profundidad.
CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid, p_caja_id uuid, p_fecha date, p_monto numeric,
  p_descripcion text, p_referencia text, p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas';
  END IF;
  -- DGG-95: redondeo defensivo a centavos + guardia NaN/NULL.
  p_monto := round(p_monto, 2);
  IF p_monto IS NULL OR NOT (p_monto > 0) THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0 (recibido: %)', p_monto;
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede cobrar un comprobante anulado';
  END IF;
  IF p_monto > v_comp.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) del comprobante',
      p_monto, v_comp.saldo_pendiente;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, comprobante_id,
    estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    NULLIF(trim(p_descripcion), ''), NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid(), p_partner_id_atribucion
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, p_monto
  );

  RETURN v_mov_id;
END;
$function$;
