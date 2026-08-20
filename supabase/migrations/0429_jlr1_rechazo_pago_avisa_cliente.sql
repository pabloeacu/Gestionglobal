-- ============================================================================
-- 0429_jlr1_rechazo_pago_avisa_cliente.sql
-- JL-R1 (reporte JL, doc 2026-08-19) · "El cliente informa un pago que ya
-- estaba cargado, gerencia lo RECHAZA con motivo, pero NO se dispara mail a la
-- clienta; ¿se le notifica en el portal? No lo veo."
--
-- Diagnóstico (caso SANCLAUDIO, pago 4f03d4f8, rechazado 17/8): pago_rechazar
-- solo insertaba una campanita in-app (notificaciones_internas) — NUNCA un
-- email. Y esa campanita enlazaba a '/portal/cuenta', ruta que NO existe (la
-- real es '/portal/cuenta-corriente'), así que ni el canal in-app llevaba a
-- un lugar útil. Mismo url roto en pago_conciliar.
--
-- Fix (quirúrgico, cero regresión):
--  (1) Template 'pago-rechazado-cliente' (manaxer-v1) con {{nombre}}/{{monto}}/
--      {{motivo}} y CTA al portal.
--  (2) pago_rechazar: mismo cuerpo + url corregido + encolar_email al cliente
--      con el motivo, envuelto en sub-bloque EXCEPTION para que un fallo de
--      mail JAMÁS aborte el rechazo (la campanita ya persistió).
--  (3) pago_conciliar: solo el url corregido (no toco su lógica de cobranza).
-- Firmas idénticas => CREATE OR REPLACE seguro (R16, smoke al pie).
-- ============================================================================

-- (1) Template del aviso de rechazo al cliente (manaxer-v1, patrón 0264).
INSERT INTO public.email_templates
  (slug, asunto, nombre, descripcion, from_casilla, layout_version, kicker,
   titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual, incluir_tabla_envio,
   cta_text, cta_url, activo, body_html, body_text)
VALUES (
  'pago-rechazado-cliente',
  'No pudimos confirmar tu pago informado — Gestión Global',
  'Cliente · pago informado rechazado',
  'Aviso al cliente cuando gerencia no puede confirmar un pago que informó desde el portal (JL-R1).',
  'general', 'manaxer-v1', 'Sobre tu pago informado',
  'No pudimos confirmar tu pago', '#b45309', true,
  '<p>Hola <strong>{{nombre}}</strong>,</p>'
  || '<p>Recibimos el pago que informaste desde tu portal'
  || '{{monto_frase}}, pero <strong>no pudimos confirmarlo</strong>. El motivo:</p>'
  || '<div style="background:#fffbeb;border-left:3px solid #b45309;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">'
  || '<p style="margin:0;color:#0f172a;white-space:pre-wrap">{{motivo}}</p></div>'
  || '<p>Si tenés una duda o pensás que es un error, respondé este correo y lo revisamos con vos.</p>',
  false,
  'Ver mi cuenta', '{{portal_url}}', true,
  '<!doctype html><html><body><p>Hola {{nombre}},</p><p>Recibimos el pago que informaste{{monto_frase}}, pero no pudimos confirmarlo. Motivo: {{motivo}}</p><p>Cualquier duda, respondé este correo.</p><p><a href="{{portal_url}}">Ver mi cuenta</a></p></body></html>',
  'Hola {{nombre}}, recibimos el pago que informaste{{monto_frase}} pero no pudimos confirmarlo. Motivo: {{motivo}}. Ver: {{portal_url}}'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto=EXCLUDED.asunto, kicker=EXCLUDED.kicker, titulo_visual=EXCLUDED.titulo_visual,
  cuerpo_html_visual=EXCLUDED.cuerpo_html_visual, cta_text=EXCLUDED.cta_text,
  cta_url=EXCLUDED.cta_url, layout_version=EXCLUDED.layout_version, activo=true;

-- (2) pago_rechazar: campanita (url corregido) + email al cliente con el motivo.
CREATE OR REPLACE FUNCTION public.pago_rechazar(p_pago_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE;
  v_cli_user uuid;
  v_email text; v_nombre text; v_monto_frase text; v_portal_url text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede rechazar' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN RAISE EXCEPTION 'Indicá el motivo del rechazo'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN RAISE EXCEPTION 'El pago ya fue %', v_pago.estado; END IF;

  UPDATE public.pagos_reportados
     SET estado='rechazado', motivo_rechazo=btrim(p_motivo), revisado_por=auth.uid(), revisado_at=now(), updated_at=now()
   WHERE id = p_pago_id;

  -- Campanita in-app (JL-R1: url corregido a /portal/cuenta-corriente).
  SELECT id INTO v_cli_user FROM public.profiles
   WHERE administracion_id = v_pago.administracion_id AND role='administrador' AND activo=true LIMIT 1;
  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'pago_rechazado', 'No pudimos confirmar tu pago', btrim(p_motivo),
            '/portal/cuenta-corriente', jsonb_build_object('pago_id', p_pago_id, 'motivo', btrim(p_motivo)));
  END IF;

  -- JL-R1: EMAIL al cliente con el motivo (best-effort — no debe abortar el rechazo).
  BEGIN
    SELECT COALESCE(NULLIF(a.email,''), NULLIF(au.email,'')),
           COALESCE(NULLIF(a.responsable_nombre,''), a.nombre, 'cliente')
      INTO v_email, v_nombre
      FROM public.administraciones a
      LEFT JOIN auth.users au ON au.id = v_cli_user
     WHERE a.id = v_pago.administracion_id;
    v_monto_frase := CASE WHEN v_pago.monto IS NOT NULL
      THEN ' (por $' || trim(to_char(v_pago.monto,'FM999G999G990D00')) || ')' ELSE '' END;
    v_portal_url := 'https://www.gestionglobal.ar/portal/cuenta-corriente';
    IF v_email IS NOT NULL THEN
      PERFORM public.encolar_email(
        'pago-rechazado-cliente', v_email, v_nombre,
        jsonb_build_object('nombre', v_nombre, 'monto_frase', v_monto_frase,
          'motivo', btrim(p_motivo), 'portal_url', v_portal_url),
        v_pago.administracion_id, NULL, 'pagos_reportados', p_pago_id, 2::smallint);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $function$;

-- (3) pago_conciliar: SOLO corregir el url roto de la campanita (misma lógica).
CREATE OR REPLACE FUNCTION public.pago_conciliar(p_pago_id uuid, p_caja_id uuid, p_categoria_id uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_monto numeric DEFAULT NULL::numeric, p_partner_id_atribucion uuid DEFAULT NULL::uuid, p_permitir_excedente boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
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
            '/portal/cuenta-corriente', jsonb_build_object('pago_id', p_pago_id, 'comprobante_id', v_comp));
  END IF;
  RETURN v_mov;
END $function$;

-- Smoke R16
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('pago_rechazar','pago_conciliar')
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'JL-R1: overload ambiguo (R16)'; END IF;
END $$;
