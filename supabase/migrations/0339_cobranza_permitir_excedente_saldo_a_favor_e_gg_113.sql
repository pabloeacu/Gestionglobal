-- 0339 · E-GG-113 (doc JL wave 6 · P10-A): sobrepago → saldo a favor.
--
-- Caso JL: el cliente transfirió $85.000 pero el comprobante debía $75.000.
-- registrar_cobranza_comprobante (único writer contable) BLOQUEA incondicionalmente
-- todo p_monto > saldo_pendiente e imputa el monto completo → nunca deja residual.
-- La infraestructura de "saldo a favor" ya existe (residual de un ingreso vivo =
-- crédito; se ve en la Cta.Cte., se lista en listar_creditos_administracion y se
-- aplica con imputar_credito_a_comprobante), pero el flujo de cobranza no tenía
-- puerta de entrada para el excedente.
--
-- Fix: 9º parámetro p_permitir_excedente boolean DEFAULT false (opt-in explícito
-- del gerente). Con excedente permitido, la transferencia entra COMPLETA a la caja
-- (1 transferencia = 1 movimiento, monto = p_monto) pero se imputa SÓLO el saldo
-- del comprobante (monto_imputado = saldo); el residual = saldo a favor automático,
-- que el modelo de créditos expone sin tocar extracto/resumen/listar_creditos.
-- Por default (false) el comportamiento es byte-idéntico: todos los callers actuales
-- (RegistrarCobranzaDrawer, pago_conciliar, cobrar-al-emitir) NO pasan el flag → un
-- fat-finger sigue dando error, no crea un crédito gigante silencioso.
--
-- R16: agrega aridad 8→9 → DROP de la firma vieja + CREATE (no CREATE OR REPLACE).

DROP FUNCTION IF EXISTS public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid, uuid);

CREATE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid,
  p_caja_id uuid,
  p_fecha date,
  p_monto numeric,
  p_descripcion text,
  p_referencia text,
  p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid,
  p_permitir_excedente boolean DEFAULT false
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
  v_imputar numeric;
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

  -- E-GG-113: sobrepago. Sin permitir_excedente → error (comportamiento previo,
  -- byte-idéntico). Con permitir_excedente → imputa sólo el saldo; el resto queda
  -- como saldo a favor (residual del ingreso).
  IF p_monto > v_comp.saldo_pendiente THEN
    IF NOT p_permitir_excedente THEN
      RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) del comprobante',
        p_monto, v_comp.saldo_pendiente;
    END IF;
    v_imputar := v_comp.saldo_pendiente;
  ELSE
    v_imputar := p_monto;
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
    v_mov_id, p_comprobante_id, v_imputar
  );

  RETURN v_mov_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid,uuid,date,numeric,text,text,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid,uuid,date,numeric,text,text,uuid,uuid,boolean) TO authenticated, service_role;
