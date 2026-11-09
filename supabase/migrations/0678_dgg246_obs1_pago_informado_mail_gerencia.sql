-- 0678_dgg246_obs1_pago_informado_mail_gerencia.sql
-- DGG-246 · Observación 1 de José Luis (doc "Sistema Gestion Global"):
--   "Cuando los clientes nos informan un pago nos avisa en Panel de Inicio y en
--    la Campanita pero NO llega un mail de aviso."
--
-- Causa: `pago_reportar` (vigente en 0332) hacía el fan-out a gerencia SÓLO por
-- campanita (notificaciones_internas) + push, con un loop manual. El email quedó
-- deliberadamente pateado ("El email queda para más adelante", comentario de 0328)
-- y nunca se agregó.
--
-- Fix (aditivo, canon): reemplazar el loop manual por una llamada a
-- `public.notify_all_gerentes(...)`, el helper estándar que dispara los 3 canales:
--   - in-app (campanita) vía private.notif_emitir → MISMO tipo 'pago_reportado',
--     título, cuerpo, url y payload que el loop anterior (cero regresión de lo que
--     JL ya ve y usa);
--   - push web (ahora SÓLO si el gerente tiene suscripción activa — estrictamente
--     mejor que el INSERT incondicional anterior, que encolaba push muerto);
--   - EMAIL vía template `gerencia-notif-generica` (el canal que faltaba).
--
-- Mismos destinatarios que la campanita: role IN ('gerente','operador') activos.
-- Misma firma → CREATE OR REPLACE (sin overload, R16 OK). SECURITY DEFINER
-- preservado (R17: escribe en notificaciones_internas/email_queue/push_queue).

CREATE OR REPLACE FUNCTION public.pago_reportar(
  p_comprobante_id uuid, p_tramite_id uuid, p_tracking_linea_id uuid,
  p_monto numeric, p_fecha_pago date, p_medio text, p_referencia text,
  p_archivo_path text, p_nota text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_admin uuid; v_pago_id uuid; v_nombre text; v_monto_txt text; v_cuerpo text;
BEGIN
  IF p_comprobante_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.comprobantes WHERE id = p_comprobante_id;
  ELSIF p_tramite_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  ELSE
    v_admin := private.current_administracion_id();
  END IF;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'No se pudo determinar la administración del pago'; END IF;
  PERFORM private.assert_administracion_access(v_admin);
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

  IF p_archivo_path IS NOT NULL AND btrim(p_archivo_path) <> ''
     AND NOT private.is_staff()
     AND split_part(btrim(p_archivo_path), '/', 1) <> v_admin::text THEN
    RAISE EXCEPTION 'El comprobante adjunto no corresponde a tu cuenta';
  END IF;

  INSERT INTO public.pagos_reportados (
    administracion_id, comprobante_id, tramite_id, tracking_linea_id,
    monto, fecha_pago, medio, referencia, archivo_path, nota, estado, reportado_por
  ) VALUES (
    v_admin, p_comprobante_id, p_tramite_id, p_tracking_linea_id,
    p_monto, coalesce(p_fecha_pago, current_date),
    coalesce(nullif(btrim(p_medio),''), 'transferencia'),
    nullif(btrim(p_referencia),''), nullif(btrim(p_archivo_path),''),
    nullif(btrim(p_nota),''), 'reportado', auth.uid()
  ) RETURNING id INTO v_pago_id;

  SELECT nombre INTO v_nombre FROM public.administraciones WHERE id = v_admin;
  v_monto_txt := '$' || trim(to_char(p_monto, 'FM999G999G990D00'));
  v_cuerpo := coalesce(v_nombre,'Un cliente') || ' informó un pago de ' || v_monto_txt
              || ' — pendiente de conciliar';

  -- DGG-246 obs 1: campanita + push + MAIL a gerencia, en una sola llamada canon.
  PERFORM public.notify_all_gerentes(
    'pago_reportado',                               -- tipo (igual que antes)
    'Cliente informó un pago',                      -- título (igual que antes)
    v_cuerpo,                                        -- cuerpo (igual que antes)
    '/gerencia/facturacion/pagos-informados',        -- url (igual que antes)
    jsonb_build_object('pago_id', v_pago_id, 'administracion_id', v_admin,
                       'monto', p_monto, 'comprobante_id', p_comprobante_id),
    true,                                            -- enviar email (lo nuevo)
    'gerencia-notif-generica',
    NULL,
    3::smallint,                                     -- prioridad: evento de atención
    'pagos_reportados',
    v_pago_id
  );

  RETURN v_pago_id;
END $function$;
