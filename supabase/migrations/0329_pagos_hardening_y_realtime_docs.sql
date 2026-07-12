-- 0329 · Cierre de hallazgos de la doble auditoría §6 (wave 2).
--
-- A#4 (media, atribución contable): pago_conciliar NO verificaba que el
--   comprobante elegido sea de la MISMA administración que el pago informado.
--   Un gerente (o bug de front) podía imputar el pago del cliente A a un
--   comprobante del cliente B. Agregamos el guard de atribución.
-- A#2 (hardening): la tabla tenía GRANT INSERT/UPDATE a authenticated (dead
--   grant: no hay policy de write). Lo endurecemos a sólo SELECT — las
--   escrituras van únicamente por las RPCs SECURITY DEFINER.
-- B#1 (GAP): el widget de docs pendientes se suscribía a tramite_pedidos_doc(
--   _items) pero esas tablas NO estaban en la publicación supabase_realtime,
--   así que no era "en vivo". Las agregamos.

-- ── A#4: guard de atribución en pago_conciliar (misma firma → R16 OK) ────────
CREATE OR REPLACE FUNCTION public.pago_conciliar(
  p_pago_id uuid, p_caja_id uuid, p_categoria_id uuid,
  p_comprobante_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE; v_comp uuid; v_comp_admin uuid; v_mov uuid; v_cli_user uuid;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede conciliar' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN RAISE EXCEPTION 'El pago ya fue %', v_pago.estado; END IF;
  v_comp := coalesce(p_comprobante_id, v_pago.comprobante_id);
  IF v_comp IS NULL THEN RAISE EXCEPTION 'Elegí el comprobante a imputar la cobranza'; END IF;

  -- A#4: el comprobante debe ser de la MISMA administración que el pago.
  SELECT administracion_id INTO v_comp_admin FROM public.comprobantes WHERE id = v_comp;
  IF v_comp_admin IS DISTINCT FROM v_pago.administracion_id THEN
    RAISE EXCEPTION 'El comprobante elegido es de otra administración; no se puede imputar acá';
  END IF;

  v_mov := public.registrar_cobranza_comprobante(
    v_comp, p_caja_id, coalesce(p_fecha, v_pago.fecha_pago), v_pago.monto,
    'Pago informado por el cliente' || coalesce(' · ' || v_pago.referencia, ''),
    v_pago.referencia, p_categoria_id, NULL);

  UPDATE public.pagos_reportados
     SET estado='conciliado', comprobante_id=v_comp, movimiento_id=v_mov,
         revisado_por=auth.uid(), revisado_at=now(), updated_at=now()
   WHERE id = p_pago_id;

  SELECT id INTO v_cli_user FROM public.profiles
   WHERE administracion_id = v_pago.administracion_id AND role='administrador' AND activo=true LIMIT 1;
  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'pago_conciliado', 'Confirmamos tu pago',
            'Registramos tu pago de $' || trim(to_char(v_pago.monto,'FM999G999G990D00')) || '. ¡Gracias!',
            '/portal/cuenta', jsonb_build_object('pago_id', p_pago_id, 'comprobante_id', v_comp));
  END IF;
  RETURN v_mov;
END $function$;

-- ── A#2: endurecer grants (writes sólo por RPC) ─────────────────────────────
REVOKE INSERT, UPDATE ON public.pagos_reportados FROM authenticated;

-- ── B#1: publicar las tablas de docs para que el widget sea realmente en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE public.tramite_pedidos_doc;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tramite_pedidos_doc_items;
