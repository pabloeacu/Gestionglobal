-- 0334 · E-GG-109 (doc JL wave 5): paridad de "Conciliar pago" con el flujo Cta.Cte.
--
-- Reporte JL: el modal de Pagos informados imputaba el monto reportado pero sin
-- mostrarlo/permitir ajustarlo, y sin atribución al partner — a diferencia del
-- RegistrarCobranzaDrawer (Cta.Cte.) que sí ofrece pago parcial + "Participa
-- partner". Se agregan p_monto (override, default = monto reportado) y
-- p_partner_id_atribucion, cableados al único writer contable
-- registrar_cobranza_comprobante (que valida monto <= saldo, E-GG-consistencia).
--
-- R16: al EXTENDER una RPC pública, DROP de la firma vieja + CREATE (no
-- CREATE OR REPLACE) para no dejar overload ambiguo (PostgREST rompería).

DROP FUNCTION IF EXISTS public.pago_conciliar(uuid, uuid, uuid, uuid, date);

CREATE FUNCTION public.pago_conciliar(
  p_pago_id               uuid,
  p_caja_id               uuid,
  p_categoria_id          uuid,
  p_comprobante_id        uuid DEFAULT NULL,
  p_fecha                 date DEFAULT NULL,
  p_monto                 numeric DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE; v_comp uuid; v_comp_admin uuid;
  v_mov uuid; v_cli_user uuid; v_monto numeric;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede conciliar' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN RAISE EXCEPTION 'El pago ya fue %', v_pago.estado; END IF;
  v_comp := coalesce(p_comprobante_id, v_pago.comprobante_id);
  IF v_comp IS NULL THEN RAISE EXCEPTION 'Elegí el comprobante a imputar la cobranza'; END IF;

  SELECT administracion_id INTO v_comp_admin FROM public.comprobantes WHERE id = v_comp;
  IF v_comp_admin IS DISTINCT FROM v_pago.administracion_id THEN
    RAISE EXCEPTION 'El comprobante elegido es de otra administración; no se puede imputar acá';
  END IF;

  -- Monto a imputar: override del gerente (pago parcial) o el reportado por el
  -- cliente. registrar_cobranza_comprobante valida que no supere el saldo.
  v_monto := coalesce(p_monto, v_pago.monto);
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'El monto a conciliar debe ser mayor a 0'; END IF;

  -- Si se atribuye a un partner, debe existir y estar activo.
  IF p_partner_id_atribucion IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo = true
  ) THEN
    RAISE EXCEPTION 'Partner de atribución inválido o inactivo';
  END IF;

  v_mov := public.registrar_cobranza_comprobante(
    v_comp, p_caja_id, coalesce(p_fecha, v_pago.fecha_pago), v_monto,
    'Pago informado por el cliente' || coalesce(' · ' || v_pago.referencia, ''),
    v_pago.referencia, p_categoria_id, p_partner_id_atribucion);

  UPDATE public.pagos_reportados
     SET estado='conciliado', comprobante_id=v_comp, movimiento_id=v_mov,
         revisado_por=auth.uid(), revisado_at=now(), updated_at=now()
   WHERE id = p_pago_id;

  SELECT id INTO v_cli_user FROM public.profiles
   WHERE administracion_id = v_pago.administracion_id AND role='administrador' AND activo=true LIMIT 1;
  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'pago_conciliado', 'Confirmamos tu pago',
            'Registramos tu pago de $' || trim(to_char(v_monto,'FM999G999G990D00')) || '. ¡Gracias!',
            '/portal/cuenta', jsonb_build_object('pago_id', p_pago_id, 'comprobante_id', v_comp));
  END IF;
  RETURN v_mov;
END $function$;

GRANT EXECUTE ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid) TO authenticated, service_role;
