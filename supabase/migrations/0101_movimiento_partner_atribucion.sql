-- ============================================================================
-- Migration: 0101_movimiento_partner_atribucion
-- Fecha: 2026-05-28
-- DGG-XX · #145: las RPCs fz_crear_movimiento_manual y
-- registrar_cobranza_comprobante aceptan p_partner_id_atribucion (uuid) que
-- se guarda en movimientos.partner_id_atribucion. Es el flag "participa
-- partner" que pidió el socio. La rendición ya lo lee (partner_crear_rendicion).
-- Defaults NULL → no rompe llamadas existentes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fz_crear_movimiento_manual(
  p_caja_id uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_categoria_id uuid DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL,
  p_consorcio_id uuid DEFAULT NULL,
  p_comprobante_imputar_a_id uuid DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('ingreso','egreso') THEN
    RAISE EXCEPTION 'tipo_invalido' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'monto_invalido' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'fecha_requerida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
    RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  IF p_comprobante_imputar_a_id IS NOT NULL AND p_tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_imputan_a_comprobantes' USING ERRCODE = '22023';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen, created_by,
    partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, p_tipo, p_monto, p_categoria_id, p_descripcion, p_referencia,
    p_administracion_id, p_consorcio_id, 'identificado', 'manual', auth.uid(),
    p_partner_id_atribucion
  )
  RETURNING id INTO v_mov_id;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    INSERT INTO public.movimiento_imputaciones (
      movimiento_id, comprobante_id, monto_imputado
    ) VALUES (
      v_mov_id, p_comprobante_imputar_a_id, p_monto
    );
  END IF;

  RETURN v_mov_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid,
  p_caja_id uuid,
  p_fecha date,
  p_monto numeric,
  p_descripcion text,
  p_referencia text,
  p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas';
  END IF;
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
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
