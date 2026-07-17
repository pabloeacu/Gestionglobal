-- 0360 · JL-W8-3 · Movimientos bancarios NO IDENTIFICADOS.
-- JL: ingresos en caja de origen desconocido. Mientras NO se reconocen: suman
-- al saldo de la caja pero NO tocan la cta.cte de ningún cliente. Al RECONOCER:
-- no re-impactan caja (ya sumaron), pero la aplicación afecta la cta.cte del
-- cliente; el movimiento pasa al historial de identificados.
--
-- DISEÑO: se REUSA el estado 'pendiente_id' que existe en el CHECK desde la
-- mig 0005 (con índice parcial, badge "Pendiente" en MovimientoBadges, contador
-- movs_pendientes en fz_dashboard_kpis y banner en el dashboard) pero que nunca
-- tuvo flujo de escritura. La cta.cte ya es inmune por construcción: todas sus
-- ramas filtran por administracion_id = p (un mov sin admin no aparece en la
-- de nadie) y las ramas de HABER exigen estado='identificado'. "Reconocer" es
-- un UPDATE (admin + estado) + imputación opcional vía la RPC EXISTENTE
-- imputar_credito_a_comprobante → cero INSERT en movimientos → caja intacta.

-- ── 1 · Historial de identificación ──────────────────────────────────────────
ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS identificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS identificado_by uuid;  -- sin FK, mismo patrón que created_by

-- ── 2 · Consistencia de saldos de caja (mandato Pablo · una sola verdad) ─────
-- La vista cajas_con_saldo contaba SOLO 'identificado' en el saldo, mientras
-- fz_listar_cajas_admin usa estado <> 'anulado'. Con 0 filas pendiente_id la
-- divergencia era latente; al nacer el primer pendiente, la card de caja y la
-- Admin de cajas mostrarían números distintos. Criterio JL ("mientras no se
-- reconocen, afectan los saldos de las cajas"): el saldo incluye pendiente_id.
CREATE OR REPLACE VIEW public.cajas_con_saldo AS
 SELECT c.id AS caja_id,
    c.nombre,
    c.tipo,
    c.moneda,
    c.color,
    c.icono,
    c.orden,
    c.activo,
    COALESCE(sum(
        CASE
            WHEN m.estado <> 'anulado'::text THEN
            CASE
                WHEN m.tipo = ANY (ARRAY['ingreso'::text, 'transferencia_in'::text]) THEN m.monto
                WHEN m.tipo = ANY (ARRAY['egreso'::text, 'transferencia_out'::text]) THEN - m.monto
                ELSE 0::numeric
            END
            ELSE 0::numeric
        END), 0::numeric) AS saldo,
    count(*) FILTER (WHERE m.estado = 'pendiente_id'::text) AS movs_pendientes
   FROM public.cajas c
     LEFT JOIN public.movimientos m ON m.caja_id = c.id
  GROUP BY c.id, c.nombre, c.tipo, c.moneda, c.color, c.icono, c.orden, c.activo;

-- fz_dashboard_kpis · ingresos/egresos del mes alineados al mismo criterio
-- (la plata pendiente ESTÁ en la caja; si el saldo la cuenta, el KPI del mes
-- también — si no, saldo_total sube sin reflejo en "Ingresos del mes").
CREATE OR REPLACE FUNCTION public.fz_dashboard_kpis()
 RETURNS TABLE(saldo_total numeric, ingresos_mes numeric, egresos_mes numeric, movs_pendientes integer, cajas_activas integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    COALESCE((SELECT SUM(saldo) FROM public.cajas_con_saldo WHERE activo), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado <> 'anulado' AND tipo='ingreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado <> 'anulado' AND tipo='egreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    (SELECT COUNT(*)::int FROM public.movimientos WHERE estado='pendiente_id'),
    (SELECT COUNT(*)::int FROM public.cajas WHERE activo)
  WHERE private.is_staff();
$$;

-- ── 3 · Alta de ingreso NO identificado (fz_crear_movimiento_manual 11→12) ───
-- R16 (E-GG-37): agregar un parámetro crea un OVERLOAD paralelo con CREATE OR
-- REPLACE → DROP de la firma vieja + CREATE + re-GRANT obligatorios.
DROP FUNCTION IF EXISTS public.fz_crear_movimiento_manual(uuid, text, numeric, date, uuid, text, text, uuid, uuid, uuid, uuid);

CREATE FUNCTION public.fz_crear_movimiento_manual(
  p_caja_id uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_categoria_id uuid DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL,
  p_consorcio_id uuid DEFAULT NULL,
  p_comprobante_imputar_a_id uuid DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL,
  p_sin_identificar boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- JL-W8-3 · un ingreso sin identificar es por definición un ingreso del que
  -- NO sabemos el cliente → no admite admin, ni imputación, ni partner.
  IF p_sin_identificar THEN
    IF p_tipo <> 'ingreso' THEN
      RAISE EXCEPTION 'solo_ingresos_pueden_quedar_sin_identificar' USING ERRCODE = '22023';
    END IF;
    IF p_administracion_id IS NOT NULL OR p_comprobante_imputar_a_id IS NOT NULL
       OR p_partner_id_atribucion IS NOT NULL THEN
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
  END IF;

  RETURN v_mov_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fz_crear_movimiento_manual(uuid, text, numeric, date, uuid, text, text, uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_crear_movimiento_manual(uuid, text, numeric, date, uuid, text, text, uuid, uuid, uuid, uuid, boolean) TO authenticated, service_role;

-- ── 4 · Reconocer (identificar) un movimiento pendiente ──────────────────────
-- El corazón del pedido: setea cliente + estado y OPCIONALMENTE aplica a un
-- comprobante reusando imputar_credito_a_comprobante (guardas E-GG-86: FOR
-- UPDATE, anulado, sobre-imputación, misma admin). CERO INSERT en movimientos
-- → la caja no se re-impacta. Lo no aplicado queda como Saldo a favor en la
-- cta.cte (rama 3 de cuenta_corriente_extracto) y en listar_creditos, aplicable
-- después con el drawer de saldo a favor (JL-3) sin código nuevo.
CREATE FUNCTION public.fz_identificar_movimiento(
  p_movimiento_id uuid,
  p_administracion_id uuid,
  p_comprobante_id uuid DEFAULT NULL,
  p_monto_imputar numeric DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mov public.movimientos%ROWTYPE;
  v_comp_saldo numeric;
  v_monto numeric;
  v_imputado numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_mov.tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_se_identifican' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado <> 'pendiente_id' THEN
    RAISE EXCEPTION 'El movimiento no está pendiente de identificar (estado %)', v_mov.estado
      USING ERRCODE = '22023';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'administracion_inexistente' USING ERRCODE = '22023';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  -- Reconocimiento: el MISMO movimiento pasa a ser un ingreso del cliente.
  UPDATE public.movimientos
     SET administracion_id = p_administracion_id,
         partner_id_atribucion = COALESCE(p_partner_id_atribucion, partner_id_atribucion),
         estado = 'identificado',
         identificado_at = now(),
         identificado_by = auth.uid()
   WHERE id = p_movimiento_id;

  -- Aplicación opcional a un comprobante del cliente (misma-admin, guardas
  -- E-GG-86 adentro de imputar_credito_a_comprobante).
  IF p_comprobante_id IS NOT NULL THEN
    SELECT saldo_pendiente INTO v_comp_saldo
      FROM public.comprobantes WHERE id = p_comprobante_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'comprobante_inexistente' USING ERRCODE = '22023';
    END IF;
    v_monto := COALESCE(p_monto_imputar, LEAST(v_mov.monto, COALESCE(v_comp_saldo, 0)));
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'El comprobante no tiene saldo pendiente para aplicar' USING ERRCODE = '22023';
    END IF;
    PERFORM public.imputar_credito_a_comprobante(p_movimiento_id, p_comprobante_id, v_monto);
    v_imputado := v_monto;
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', p_movimiento_id,
    'administracion_id', p_administracion_id,
    'imputado', v_imputado,
    -- residual = monto − Σ imputaciones vivas (post-aplicación); queda como
    -- Saldo a favor del cliente en la cta.cte
    'saldo_a_favor_restante', v_mov.monto
      - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                   WHERE mi.movimiento_id = p_movimiento_id), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fz_identificar_movimiento(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_identificar_movimiento(uuid, uuid, uuid, numeric, uuid) TO authenticated, service_role;

-- ── 5 · Deshacer una identificación errónea ──────────────────────────────────
-- (Hipótesis JL: "reconocí al cliente equivocado".) Sólo si el movimiento pasó
-- por el flujo de identificación (identificado_at NOT NULL) y NO tiene
-- aplicaciones vivas — si las tiene, primero desimputar (flujo existente).
CREATE FUNCTION public.fz_desidentificar_movimiento(p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mov public.movimientos%ROWTYPE;
  v_imps int;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_mov.identificado_at IS NULL OR v_mov.estado <> 'identificado' THEN
    RAISE EXCEPTION 'El movimiento no proviene del flujo de identificación' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_imps FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;
  IF v_imps > 0 THEN
    RAISE EXCEPTION 'El movimiento tiene % aplicación(es) a comprobantes — quitá primero el saldo aplicado desde la cuenta corriente', v_imps
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.movimientos
     SET administracion_id = NULL,
         partner_id_atribucion = NULL,
         estado = 'pendiente_id',
         identificado_at = NULL,
         identificado_by = NULL
   WHERE id = p_movimiento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fz_desidentificar_movimiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_desidentificar_movimiento(uuid) TO authenticated, service_role;
