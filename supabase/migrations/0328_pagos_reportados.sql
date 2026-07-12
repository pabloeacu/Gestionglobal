-- 0328 · #1/#2 (reporte JL): "informar un pago" desde el portal del cliente.
--
-- Diseño confirmado por Pablo: el cliente INFORMA un pago (intención), NO crea
-- un asiento. Se crea una fila en `pagos_reportados` (estado 'reportado') que
-- avisa a gerencia (campanita + push). El saldo NO se mueve hasta que un gerente
-- CONCILIA. La conciliación pasa SIEMPRE por `registrar_cobranza_comprobante`
-- (única escritora de movimientos/imputaciones → una sola fuente de verdad,
-- canon contable). Reglas: R2 (RLS), R5/R17 (SECURITY DEFINER + search_path),
-- R6 (GRANTs), R11 (índices de FK), R12 (tenancy assert_administracion_access),
-- R19 (KPIs sobre el universo real: el saldo no cambia hasta conciliar).

-- ── Tabla ───────────────────────────────────────────────────────────────────
CREATE TABLE public.pagos_reportados (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id),
  comprobante_id    uuid REFERENCES public.comprobantes(id),
  tramite_id        uuid REFERENCES public.tramites(id),
  tracking_linea_id uuid,
  monto             numeric NOT NULL CHECK (monto > 0),
  fecha_pago        date NOT NULL,
  medio             text NOT NULL DEFAULT 'transferencia'
                      CHECK (medio IN ('transferencia','deposito','mercadopago','efectivo','otro')),
  referencia        text,
  archivo_path      text,
  nota              text,
  estado            text NOT NULL DEFAULT 'reportado'
                      CHECK (estado IN ('reportado','conciliado','rechazado')),
  movimiento_id     uuid,
  motivo_rechazo    text,
  reportado_por     uuid,
  revisado_por      uuid,
  revisado_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pagos_reportados ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.pagos_reportados TO authenticated;

-- Índices (R11): FKs + cola de gerencia por estado.
CREATE INDEX idx_pagos_reportados_admin       ON public.pagos_reportados(administracion_id);
CREATE INDEX idx_pagos_reportados_estado      ON public.pagos_reportados(estado);
CREATE INDEX idx_pagos_reportados_comprobante ON public.pagos_reportados(comprobante_id);
CREATE INDEX idx_pagos_reportados_tramite     ON public.pagos_reportados(tramite_id);

-- RLS: el cliente ve las de SU administración; gerencia ve todo. Las escrituras
-- pasan por las RPCs (SECURITY DEFINER), no hay policy de INSERT/UPDATE directo.
CREATE POLICY pagos_reportados_sel ON public.pagos_reportados
  FOR SELECT TO authenticated
  USING (administracion_id = private.current_administracion_id() OR private.is_staff());

COMMENT ON TABLE public.pagos_reportados IS
  '#1/#2 · Pago INFORMADO por el cliente (intención, no asiento). Se concilia a '
  'movimiento vía registrar_cobranza_comprobante. El saldo no cambia hasta conciliar.';

-- ── RPC: el cliente informa un pago ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pago_reportar(
  p_comprobante_id    uuid,
  p_tramite_id        uuid,
  p_tracking_linea_id uuid,
  p_monto             numeric,
  p_fecha_pago        date,
  p_medio             text,
  p_referencia        text,
  p_archivo_path      text,
  p_nota              text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin   uuid;
  v_pago_id uuid;
  v_nombre  text;
  v_ger     record;
  v_monto_txt text;
BEGIN
  -- Derivar la administración: del comprobante, del trámite, o la del cliente.
  IF p_comprobante_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.comprobantes WHERE id = p_comprobante_id;
  ELSIF p_tramite_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  ELSE
    v_admin := private.current_administracion_id();
  END IF;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar la administración del pago';
  END IF;

  -- Tenancy (R12): el cliente sólo informa pagos de SU administración.
  PERFORM private.assert_administracion_access(v_admin);

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
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

  -- Fan-out a gerencia (campanita + push). El email queda para más adelante
  -- (evita crear una plantilla nueva ahora).
  FOR v_ger IN
    SELECT id FROM public.profiles WHERE role IN ('gerente','operador') AND activo = true
  LOOP
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_ger.id, 'pago_reportado',
            'Cliente informó un pago',
            coalesce(v_nombre,'Un cliente') || ' informó un pago de ' || v_monto_txt || ' — pendiente de conciliar',
            '/gerencia/facturacion/pagos-informados',
            jsonb_build_object('pago_id', v_pago_id, 'administracion_id', v_admin,
                               'monto', p_monto, 'comprobante_id', p_comprobante_id));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_ger.id, 'Cliente informó un pago',
            left(coalesce(v_nombre,'Un cliente') || ' · ' || v_monto_txt, 140),
            '/gerencia/facturacion/pagos-informados');
  END LOOP;

  RETURN v_pago_id;
END
$function$;

REVOKE ALL ON FUNCTION public.pago_reportar(uuid,uuid,uuid,numeric,date,text,text,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pago_reportar(uuid,uuid,uuid,numeric,date,text,text,text,text) TO authenticated;

-- ── RPC: gerencia concilia (→ registrar_cobranza_comprobante) ───────────────
CREATE OR REPLACE FUNCTION public.pago_conciliar(
  p_pago_id       uuid,
  p_caja_id       uuid,
  p_categoria_id  uuid,
  p_comprobante_id uuid DEFAULT NULL,
  p_fecha         date  DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE;
  v_comp uuid;
  v_mov  uuid;
  v_cli_user uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede conciliar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN
    RAISE EXCEPTION 'El pago ya fue %', v_pago.estado;
  END IF;

  -- Comprobante a imputar: el que eligió el gerente, o el que informó el cliente.
  v_comp := coalesce(p_comprobante_id, v_pago.comprobante_id);
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Elegí el comprobante a imputar la cobranza';
  END IF;

  -- Única escritora del asiento (canon contable).
  v_mov := public.registrar_cobranza_comprobante(
    v_comp,
    p_caja_id,
    coalesce(p_fecha, v_pago.fecha_pago),
    v_pago.monto,
    'Pago informado por el cliente' || coalesce(' · ' || v_pago.referencia, ''),
    v_pago.referencia,
    p_categoria_id,
    NULL
  );

  UPDATE public.pagos_reportados
     SET estado        = 'conciliado',
         comprobante_id = v_comp,
         movimiento_id = v_mov,
         revisado_por  = auth.uid(),
         revisado_at   = now(),
         updated_at    = now()
   WHERE id = p_pago_id;

  -- Avisar al cliente: confirmamos tu pago.
  SELECT id INTO v_cli_user FROM public.profiles
   WHERE administracion_id = v_pago.administracion_id AND role = 'administrador' AND activo = true
   LIMIT 1;
  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'pago_conciliado',
            'Confirmamos tu pago',
            'Registramos tu pago de $' || trim(to_char(v_pago.monto,'FM999G999G990D00')) || '. ¡Gracias!',
            '/portal/cuenta',
            jsonb_build_object('pago_id', p_pago_id, 'comprobante_id', v_comp));
  END IF;

  RETURN v_mov;
END
$function$;

REVOKE ALL ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pago_conciliar(uuid,uuid,uuid,uuid,date) TO authenticated;

-- ── RPC: gerencia rechaza ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pago_rechazar(p_pago_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago public.pagos_reportados%ROWTYPE;
  v_cli_user uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede rechazar' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'Indicá el motivo del rechazo';
  END IF;

  SELECT * INTO v_pago FROM public.pagos_reportados WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago informado % no existe', p_pago_id; END IF;
  IF v_pago.estado <> 'reportado' THEN
    RAISE EXCEPTION 'El pago ya fue %', v_pago.estado;
  END IF;

  UPDATE public.pagos_reportados
     SET estado         = 'rechazado',
         motivo_rechazo = btrim(p_motivo),
         revisado_por   = auth.uid(),
         revisado_at    = now(),
         updated_at     = now()
   WHERE id = p_pago_id;

  SELECT id INTO v_cli_user FROM public.profiles
   WHERE administracion_id = v_pago.administracion_id AND role = 'administrador' AND activo = true
   LIMIT 1;
  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'pago_rechazado',
            'No pudimos confirmar tu pago',
            btrim(p_motivo),
            '/portal/cuenta',
            jsonb_build_object('pago_id', p_pago_id, 'motivo', btrim(p_motivo)));
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.pago_rechazar(uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pago_rechazar(uuid,text) TO authenticated;
