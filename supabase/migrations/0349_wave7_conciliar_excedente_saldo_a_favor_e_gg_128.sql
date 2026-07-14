-- 0349 · WAVE 7 · E-GG-128 (pág.4 JL): al conciliar un pago informado por el
-- cliente que SUPERA el saldo del comprobante, ofrecer "dejar el excedente como
-- saldo a favor" — igual que el flujo Cobrar (RegistrarCobranzaDrawer, E-GG-113).
--
-- SÍNTOMA (JL, captura pág.4): cliente informó $85.000 contra un comprobante de
-- saldo $75.000. El modal Conciliar mostraba SÓLO el warning "El importe supera el
-- saldo del comprobante. Ajustá el monto o elegí otro" y deshabilitaba el botón —
-- sin la opción de dejar los $10.000 a favor. En el cierre de wave 6 afirmé que el
-- sobrepago→saldo a favor "andaba", pero eso era el flujo COBRAR; el flujo CONCILIAR
-- (pago_conciliar) NO exponía el opt-in. Hueco real.
--
-- FIX: pago_conciliar gana un parámetro p_permitir_excedente boolean DEFAULT false
-- que se pasa a registrar_cobranza_comprobante (único writer contable, ya soporta el
-- excedente → residual como crédito). Como CAMBIA la aridad de una RPC pública
-- (R16): DROP de la firma vieja (7 args) + CREATE de la nueva (8 args), NUNCA
-- CREATE OR REPLACE solo (crearía un overload ambiguo → PostgREST 300).
-- Se re-aplican los grants (REVOKE anon de E-GG-119 + GRANT authenticated).

DROP FUNCTION IF EXISTS public.pago_conciliar(uuid, uuid, uuid, uuid, date, numeric, uuid);

CREATE FUNCTION public.pago_conciliar(
  p_pago_id uuid,
  p_caja_id uuid,
  p_categoria_id uuid,
  p_comprobante_id uuid DEFAULT NULL::uuid,
  p_fecha date DEFAULT NULL::date,
  p_monto numeric DEFAULT NULL::numeric,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid,
  p_permitir_excedente boolean DEFAULT false
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE; v_comp uuid; v_comp_admin uuid;
  v_mov uuid; v_cli_user uuid; v_monto numeric;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RAISE EXCEPTION 'Solo gerencia puede conciliar' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN RAISE EXCEPTION 'El pago ya fue %', v_pago.estado; END IF;
  v_comp := coalesce(p_comprobante_id, v_pago.comprobante_id);
  IF v_comp IS NULL THEN RAISE EXCEPTION 'Elegí el comprobante a imputar la cobranza'; END IF;

  SELECT administracion_id INTO v_comp_admin FROM public.comprobantes WHERE id = v_comp;
  IF v_comp_admin IS DISTINCT FROM v_pago.administracion_id THEN
    RAISE EXCEPTION 'El comprobante elegido es de otra administración; no se puede imputar acá';
  END IF;

  v_monto := coalesce(p_monto, v_pago.monto);
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'El monto a conciliar debe ser mayor a 0'; END IF;

  IF p_partner_id_atribucion IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo = true
  ) THEN
    RAISE EXCEPTION 'Partner de atribución inválido o inactivo';
  END IF;

  -- E-GG-128: pasar el opt-in de excedente al único writer contable. Si el monto
  -- supera el saldo y p_permitir_excedente=true, imputa el saldo y deja el resto
  -- como crédito (saldo a favor); si es false, registrar_cobranza_comprobante
  -- mantiene su validación estricta (bloquea el sobrepago).
  v_mov := public.registrar_cobranza_comprobante(
    v_comp, p_caja_id, coalesce(p_fecha, v_pago.fecha_pago), v_monto,
    'Pago informado por el cliente' || coalesce(' · ' || v_pago.referencia, ''),
    v_pago.referencia, p_categoria_id, p_partner_id_atribucion,
    coalesce(p_permitir_excedente, false));

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

-- Grants (E-GG-119: pago_conciliar es staff-only; nunca alcanzable por anon).
REVOKE ALL ON FUNCTION public.pago_conciliar(uuid, uuid, uuid, uuid, date, numeric, uuid, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pago_conciliar(uuid, uuid, uuid, uuid, date, numeric, uuid, boolean) TO authenticated, service_role;
