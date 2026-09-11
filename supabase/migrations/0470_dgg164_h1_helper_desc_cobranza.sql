-- DGG-164 · H1 (§6 agente A): cerrar la vía PARALELA que reproduce el mismo bug.
-- `fz_crear_movimiento_manual` puede crear un ingreso e imputarlo a un comprobante
-- en un solo paso (p_comprobante_imputar_a_id), insertando la descripción cruda
-- (posible NULL) sin derivar "Cobranza · <servicio>". Hoy ningún componente pasa
-- ese parámetro (inalcanzable desde la UI), pero es alcanzable por la capa de
-- servicio/RPC → hueco latente. Lo cerramos con un helper ÚNICO de formato para
-- que las dos vías (y las futuras) queden byte-idénticas y no diverjan (Q4 del §6).
--
-- Helper en `private` (interno; sólo lo invocan funciones SECURITY DEFINER como el
-- owner, no necesita GRANT a authenticated). Mismo formato que fz_identificar_movimiento
-- y registrar_cobranza_comprobante: 'Cobranza · <primer item>' (fallback al número).

CREATE OR REPLACE FUNCTION private.gg_desc_cobranza(p_comprobante_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT 'Cobranza · ' || i.descripcion
       FROM public.items_comprobantes i
      WHERE i.comprobante_id = p_comprobante_id
        AND NULLIF(trim(i.descripcion), '') IS NOT NULL
      ORDER BY i.orden ASC, i.created_at ASC LIMIT 1),
    (SELECT 'Cobranza · ' || c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0')
            || '-' || COALESCE(lpad(c.numero::text, 8, '0'), 's/n')
       FROM public.comprobantes c WHERE c.id = p_comprobante_id)
  );
$function$;

-- imputar_credito_a_comprobante: usar el helper (DRY; equivalente a 0469).
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

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor no existe'; END IF;
  IF v_mov.tipo <> 'ingreso' OR v_mov.estado <> 'identificado' OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento no es un ingreso disponible';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
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

  INSERT INTO public.movimiento_imputaciones
    (movimiento_id, comprobante_id, administracion_id, monto_imputado, nota, created_by)
  VALUES (p_movimiento_id, p_comprobante_id, NULL, p_monto,
          'Saldo a favor aplicado (crédito por anulación/pago a cuenta)', v_user);

  UPDATE public.movimientos m
     SET descripcion = private.gg_desc_cobranza(p_comprobante_id)
   WHERE m.id = p_movimiento_id
     AND NULLIF(btrim(m.descripcion), '') IS NULL;

  RETURN jsonb_build_object('ok', true,
    'credito_restante', v_saldo_credito - p_monto,
    'comprobante_saldo', (SELECT saldo_pendiente FROM public.comprobantes WHERE id = p_comprobante_id));
END;
$function$;

-- fz_crear_movimiento_manual: al imputar inline un ingreso a un comprobante, si no
-- vino descripción, rotularlo como cobranza del servicio (mismo helper). Cuerpo
-- idéntico al vivo + el bloque de rótulo tras la imputación (H1).
CREATE OR REPLACE FUNCTION public.fz_crear_movimiento_manual(p_caja_id uuid, p_tipo text, p_monto numeric, p_fecha date, p_categoria_id uuid DEFAULT NULL::uuid, p_descripcion text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_administracion_id uuid DEFAULT NULL::uuid, p_consorcio_id uuid DEFAULT NULL::uuid, p_comprobante_imputar_a_id uuid DEFAULT NULL::uuid, p_partner_id_atribucion uuid DEFAULT NULL::uuid, p_sin_identificar boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mov_id uuid;
  v_comp_saldo numeric;
  v_comp_estado text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_tipo NOT IN ('ingreso','egreso') THEN RAISE EXCEPTION 'tipo_invalido' USING ERRCODE = '22023'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'monto_invalido' USING ERRCODE = '22023'; END IF;
  IF p_fecha IS NULL THEN RAISE EXCEPTION 'fecha_requerida' USING ERRCODE = '22023'; END IF;
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

  IF p_sin_identificar THEN
    IF p_tipo <> 'ingreso' THEN
      RAISE EXCEPTION 'solo_ingresos_pueden_quedar_sin_identificar' USING ERRCODE = '22023';
    END IF;
    IF p_administracion_id IS NOT NULL OR p_consorcio_id IS NOT NULL
       OR p_comprobante_imputar_a_id IS NOT NULL OR p_partner_id_atribucion IS NOT NULL THEN
      RAISE EXCEPTION 'sin_identificar_incompatible_con_cliente_imputacion_o_partner' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    SELECT saldo_pendiente, estado INTO v_comp_saldo, v_comp_estado
      FROM public.comprobantes WHERE id = p_comprobante_imputar_a_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'comprobante_a_imputar_inexistente' USING ERRCODE = '22023';
    END IF;
    IF v_comp_estado = 'anulado' THEN
      RAISE EXCEPTION 'comprobante_anulado_no_admite_imputacion' USING ERRCODE = '22023';
    END IF;
    IF p_monto > COALESCE(v_comp_saldo, 0) + 0.001 THEN
      RAISE EXCEPTION 'El monto (%) supera el saldo del comprobante (%)', p_monto, v_comp_saldo
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, p_tipo, p_monto, p_categoria_id, p_descripcion, p_referencia,
    p_administracion_id, p_consorcio_id,
    CASE WHEN p_sin_identificar THEN 'pendiente_id' ELSE 'identificado' END,
    'manual', auth.uid(), p_partner_id_atribucion
  )
  RETURNING id INTO v_mov_id;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    INSERT INTO public.movimiento_imputaciones (movimiento_id, comprobante_id, monto_imputado)
    VALUES (v_mov_id, p_comprobante_imputar_a_id, p_monto);
    -- DGG-164 H1 · si no vino descripción, rotular como cobranza del servicio.
    IF NULLIF(btrim(p_descripcion), '') IS NULL THEN
      UPDATE public.movimientos SET descripcion = private.gg_desc_cobranza(p_comprobante_imputar_a_id)
       WHERE id = v_mov_id;
    END IF;
  END IF;

  RETURN v_mov_id;
END;
$function$;
