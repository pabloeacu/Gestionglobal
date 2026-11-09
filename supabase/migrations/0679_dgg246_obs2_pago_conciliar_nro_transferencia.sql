-- 0679_dgg246_obs2_pago_conciliar_nro_transferencia.sql
-- DGG-246 · Observación 2 de José Luis:
--   "Al abrir la ventana para imputar la cobranza aparecen las opciones de la
--    caja, el partner, la fecha la pone automáticamente > estaría faltando que
--    coloque automáticamente o que tengamos la opción para poner el N° de
--    Transferencia." (en algunos movimientos aparece "Transf N°", en otros no).
--
-- Diagnóstico: el N° de transferencia vive en `movimientos.referencia` y se
-- muestra como "Transf N°" en Finanzas. Hoy `pago_conciliar` usa SIEMPRE y SÓLO
-- `v_pago.referencia` (lo que el cliente tipeó, campo OPCIONAL en el portal) →
-- si el cliente lo dejó en blanco, el movimiento queda sin "Transf N°" y gerencia
-- NO tiene dónde cargarlo al conciliar. De ahí la inconsistencia.
--
-- Fix: agregar `p_referencia text DEFAULT NULL` al final de la firma. Si gerencia
-- lo completa/corrige en el modal, prevalece; si lo deja vacío, cae a lo que
-- informó el cliente (v_pago.referencia). Se escribe en `movimientos.referencia`
-- (descripción + columna referencia) → aparece como "Transf N°", consistente.
--
-- R16: agregar un parámetro cambia la cantidad de args → DROP de la firma vieja
-- ANTES del CREATE (si no, PostgREST ve 2 overloads y falla con "Could not choose
-- the best candidate function"). Único caller: el servicio `conciliarPago`
-- (params nombrados) → agregar un param opcional es backward-compatible.
-- SECURITY DEFINER + tenancy guard (is_staff) preservados.

DROP FUNCTION IF EXISTS public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid,boolean);

CREATE OR REPLACE FUNCTION public.pago_conciliar(
  p_pago_id uuid, p_caja_id uuid, p_categoria_id uuid,
  p_comprobante_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date,
  p_monto numeric DEFAULT NULL::numeric, p_partner_id_atribucion uuid DEFAULT NULL::uuid,
  p_permitir_excedente boolean DEFAULT false,
  p_referencia text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE; v_comp uuid; v_comp_admin uuid;
  v_mov uuid; v_cli_user uuid; v_monto numeric; v_ref text;
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

  -- DGG-246 obs 2: N° de transferencia. Lo que gerencia carga/corrige prevalece;
  -- si lo deja vacío, cae a lo que informó el cliente. Va a movimientos.referencia.
  v_ref := coalesce(nullif(btrim(p_referencia), ''), v_pago.referencia);

  v_mov := public.registrar_cobranza_comprobante(
    v_comp, p_caja_id, coalesce(p_fecha, v_pago.fecha_pago), v_monto,
    'Pago informado por el cliente' || coalesce(' · ' || v_ref, ''),
    v_ref, p_categoria_id, p_partner_id_atribucion,
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
            '/portal/cuenta-corriente', jsonb_build_object('pago_id', p_pago_id, 'comprobante_id', v_comp));
  END IF;
  RETURN v_mov;
END $function$;

REVOKE ALL ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date,numeric,uuid,boolean,text) TO authenticated, service_role;
