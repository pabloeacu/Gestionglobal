-- ============================================================================
-- 0266_saldo_a_favor_desimputar_y_reversa_guards.sql
-- DGG-91 · Hallazgos de la doble auditoría §6 del chunk "saldo a favor":
--
-- E-GG-77 (CRÍTICO, pérdida de dato): desimputar_cobranza borraba el movimiento
--   al quedar en 0 imputaciones + origen='facturacion'. Un CRÉDITO (pago de un
--   comprobante anulado) aplicado a otro comprobante y luego desimputado caía en
--   esa rama → se destruía el crédito y el registro del pago original. Fix: sólo
--   borrar el movimiento cuando es una cobranza "fresca" del MISMO comprobante
--   (mov.comprobante_id = imp.comprobante_id). Para un crédito aplicado a otro
--   comprobante los ids DIFIEREN → se conserva el movimiento y el crédito vuelve
--   a estar disponible. (Invariante: registrar_cobranza_comprobante setea
--   mov.comprobante_id = comprobante pagado = imp.comprobante_id.)
--
-- E-GG-78: fz_revertir_movimiento no tenía guarda para un ingreso cuyo crédito
--   ya fue aplicado a OTRO comprobante → generaba un contrasiento por el monto
--   total (posible descuadre) y borraba silenciosamente la aplicación. Fix:
--   bloquear la reversa si el ingreso tiene imputaciones a comprobantes distintos
--   del propio; exige desimputar primero.
--
-- Refinamiento menor (race): imputar_credito_a_comprobante ahora lockea el
--   movimiento de crédito (FOR UPDATE) para serializar dos aplicaciones
--   concurrentes del mismo crédito.
-- ============================================================================

-- (1) desimputar_cobranza — no borrar el movimiento si es un crédito aplicado
CREATE OR REPLACE FUNCTION public.desimputar_cobranza(p_imputacion_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_imp public.movimiento_imputaciones%ROWTYPE;
  v_mov public.movimientos%ROWTYPE;
  v_remaining int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede desimputar';
  END IF;

  SELECT * INTO v_imp FROM public.movimiento_imputaciones WHERE id = p_imputacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Imputacion no encontrada';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = v_imp.movimiento_id;

  DELETE FROM public.movimiento_imputaciones WHERE id = p_imputacion_id;

  SELECT count(*) INTO v_remaining
  FROM public.movimiento_imputaciones WHERE movimiento_id = v_imp.movimiento_id;

  -- E-GG-77: sólo limpiar el movimiento si era una cobranza "fresca" del MISMO
  -- comprobante. Si es un crédito (saldo a favor) aplicado a otro comprobante,
  -- mov.comprobante_id (origen) <> imp.comprobante_id (destino) → conservarlo:
  -- el crédito vuelve a quedar disponible en lugar de destruirse.
  IF v_remaining = 0 AND v_mov.origen = 'facturacion'
     AND v_mov.comprobante_id IS NOT DISTINCT FROM v_imp.comprobante_id THEN
    DELETE FROM public.movimientos WHERE id = v_imp.movimiento_id;
  END IF;

  RETURN v_imp.comprobante_id;
END;
$function$;

-- (2) fz_revertir_movimiento — guarda: no revertir un ingreso con crédito aplicado a otro comprobante
CREATE OR REPLACE FUNCTION public.fz_revertir_movimiento(p_movimiento_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mov record; v_par record; v_tipo_reverso text;
  v_nueva_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_ya_revertido' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado = 'anulado' THEN
    RAISE EXCEPTION 'movimiento_anulado_no_se_revierte' USING ERRCODE = '22023';
  END IF;
  IF v_mov.origen = 'reversion' THEN
    RAISE EXCEPTION 'no_se_puede_revertir_un_contrasiento' USING ERRCODE = '22023';
  END IF;

  -- E-GG-78: si este ingreso tiene saldo a favor aplicado a OTRO comprobante,
  -- revertirlo generaría un contrasiento por el monto total y borraría esa
  -- aplicación. Exigir desimputar esa aplicación primero.
  IF EXISTS (
    SELECT 1 FROM public.movimiento_imputaciones mi
    WHERE mi.movimiento_id = p_movimiento_id
      AND mi.comprobante_id IS NOT NULL
      AND mi.comprobante_id IS DISTINCT FROM v_mov.comprobante_id
  ) THEN
    RAISE EXCEPTION 'Este ingreso tiene saldo a favor aplicado a otro comprobante. Desimputá esa aplicación antes de revertir el movimiento.'
      USING ERRCODE = '22023';
  END IF;

  v_tipo_reverso := CASE v_mov.tipo
    WHEN 'ingreso' THEN 'egreso'
    WHEN 'egreso' THEN 'ingreso'
    WHEN 'transferencia_in' THEN 'transferencia_out'
    WHEN 'transferencia_out' THEN 'transferencia_in'
  END;

  DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen,
    movimiento_revertido_id, created_by
  ) VALUES (
    v_mov.caja_id, CURRENT_DATE, v_tipo_reverso, v_mov.monto,
    'Reversión del ' || to_char(v_mov.fecha, 'DD/MM/YYYY')
      || CASE WHEN p_motivo IS NOT NULL THEN ' · ' || p_motivo ELSE '' END,
    v_mov.referencia, v_mov.administracion_id, v_mov.consorcio_id,
    'identificado', 'reversion', p_movimiento_id, auth.uid()
  )
  RETURNING id INTO v_nueva_id;

  UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = p_movimiento_id;

  IF v_mov.transferencia_pair_id IS NOT NULL THEN
    SELECT * INTO v_par FROM public.movimientos
     WHERE transferencia_pair_id = v_mov.transferencia_pair_id
       AND id <> p_movimiento_id AND revertido_at IS NULL FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = v_par.id;
      v_tipo_reverso := CASE v_par.tipo
        WHEN 'transferencia_in' THEN 'transferencia_out'
        WHEN 'transferencia_out' THEN 'transferencia_in'
        ELSE v_par.tipo
      END;
      INSERT INTO public.movimientos (
        caja_id, fecha, tipo, monto, descripcion, referencia,
        estado, origen, movimiento_revertido_id, created_by
      ) VALUES (
        v_par.caja_id, CURRENT_DATE, v_tipo_reverso, v_par.monto,
        'Reversión de transferencia · pareja', v_par.referencia,
        'identificado', 'reversion', v_par.id, auth.uid()
      );
      UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = v_par.id;
    END IF;
  END IF;

  RETURN v_nueva_id;
END;
$function$;

-- (3) imputar_credito_a_comprobante — lockear el crédito (serializa concurrentes)
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

  -- FOR UPDATE: serializa dos aplicaciones concurrentes del mismo crédito.
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
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

  -- destino = comprobante ⇒ administracion_id DEBE ir NULL (chk_imp_destino_xor)
  INSERT INTO public.movimiento_imputaciones
    (movimiento_id, comprobante_id, administracion_id, monto_imputado, nota, created_by)
  VALUES (p_movimiento_id, p_comprobante_id, NULL, p_monto,
          'Saldo a favor aplicado (crédito por anulación/pago a cuenta)', v_user);

  RETURN jsonb_build_object('ok', true,
    'credito_restante', v_saldo_credito - p_monto,
    'comprobante_saldo', (SELECT saldo_pendiente FROM public.comprobantes WHERE id = p_comprobante_id));
END;
$function$;
