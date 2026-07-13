-- 0336 · E-GG-109b: cierre de hueco de permisos en pago_conciliar (regresión de 0334).
--
-- Hallazgo de la doble auditoría §6: la mig 0334 reescribió pago_conciliar con
-- DROP FUNCTION + CREATE FUNCTION. Como el proyecto tiene ALTER DEFAULT
-- PRIVILEGES que auto-otorga EXECUTE a anon/PUBLIC en toda función nueva
-- (patrón E-GG-88, mig 0279/0291), la nueva función quedó ejecutable por anon
-- con la anon-key pública — la 0334 omitió el REVOKE canónico. Peor: el
-- backstop `IF NOT private.is_staff()` FALLA-ABIERTO para anon: auth.uid()=NULL
-- → get_user_role()=NULL → is_staff()=NULL → `NOT NULL`=NULL → el IF no dispara
-- el RAISE. Doble fix:
--   (1) REVOKE de anon/PUBLIC (defensa primaria, patrón canónico).
--   (2) guard `IS NOT TRUE` (rebota NULL/anon además de false).

-- (2) Guard hardening — misma firma → CREATE OR REPLACE (R16 ok, sin overload).
CREATE OR REPLACE FUNCTION public.pago_conciliar(
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
  -- IS NOT TRUE rebota tanto false (rol no-staff) como NULL (anon sin rol).
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

-- (1) REVOKE canónico: la conciliación es staff-only, nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid) TO authenticated, service_role;
