-- 0055_finanzas_operaciones.sql — Bloque 1 del módulo Finanzas
--
-- Operaciones diarias sobre cajas/movimientos. Capitaliza el schema de
-- 0005_ctacte_finanzas.sql (cajas + movimientos + movimiento_imputaciones +
-- VIEW cajas_con_saldo) y agrega las RPCs operativas.
--
-- RPCs:
--   - fz_crear_movimiento_manual    → alta de ingreso/egreso manual.
--   - fz_crear_transferencia        → atómica · 2 movs pareados.
--   - fz_revertir_movimiento        → contrasiento atómico.
--   - fz_anular_movimiento          → soft delete (estado='anulado').
--   - fz_dashboard_kpis             → KPIs del dashboard.
--   - fz_listar_movimientos         → listado paginado con filtros.
--
-- Convención naming: prefix `fz_` (finanzas). Toda RPC es SECURITY DEFINER
-- con search_path = public, pg_temp y guard is_staff (gerentes/operadores).

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) Crear movimiento manual (ingreso o egreso)
-- ────────────────────────────────────────────────────────────────
-- Para tipo='ingreso' con p_comprobante_imputar_a_id se crea también la
-- imputación contra ese comprobante (el trigger recalcula saldo_pendiente).
-- p_administracion_id se setea aunque no haya imputación: queda atado a la
-- contraparte para reportería.

CREATE OR REPLACE FUNCTION public.fz_crear_movimiento_manual(
  p_caja_id uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_categoria_id uuid DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL,
  p_consorcio_id uuid DEFAULT NULL,
  p_comprobante_imputar_a_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('ingreso','egreso') THEN
    RAISE EXCEPTION 'tipo_invalido: solo ingreso/egreso (transferencias usar fz_crear_transferencia)' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'monto_invalido' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'fecha_requerida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
    RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  IF p_comprobante_imputar_a_id IS NOT NULL AND p_tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_imputan_a_comprobantes' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen, created_by
  ) VALUES (
    p_caja_id, p_fecha, p_tipo, p_monto, p_categoria_id, p_descripcion, p_referencia,
    p_administracion_id, p_consorcio_id, 'identificado', 'manual', auth.uid()
  )
  RETURNING id INTO v_mov_id;

  -- Imputar a comprobante si corresponde (trigger recalcula saldo del comp).
  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    INSERT INTO public.movimiento_imputaciones (
      movimiento_id, comprobante_id, monto_imputado
    ) VALUES (
      v_mov_id, p_comprobante_imputar_a_id, p_monto
    );
  END IF;

  RETURN v_mov_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_crear_movimiento_manual(uuid, text, numeric, date, uuid, text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_crear_movimiento_manual(uuid, text, numeric, date, uuid, text, text, uuid, uuid, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2) Transferencia entre cajas (atómica)
-- ────────────────────────────────────────────────────────────────
-- Crea 2 movimientos pareados por transferencia_pair_id:
--   - en caja origen: tipo='transferencia_out'
--   - en caja destino: tipo='transferencia_in'
-- Ambos con origen='transferencia'. Mismo monto, misma fecha.

CREATE OR REPLACE FUNCTION public.fz_crear_transferencia(
  p_caja_origen_id uuid,
  p_caja_destino_id uuid,
  p_monto numeric,
  p_fecha date,
  p_descripcion text DEFAULT NULL,
  p_referencia text DEFAULT NULL
) RETURNS uuid -- transferencia_pair_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pair_id uuid := extensions.gen_random_uuid();
  v_caja_origen_moneda text;
  v_caja_destino_moneda text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_caja_origen_id = p_caja_destino_id THEN
    RAISE EXCEPTION 'cajas_iguales' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'monto_invalido' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'fecha_requerida' USING ERRCODE = '22023';
  END IF;

  SELECT moneda INTO v_caja_origen_moneda FROM public.cajas WHERE id = p_caja_origen_id AND activo;
  IF v_caja_origen_moneda IS NULL THEN
    RAISE EXCEPTION 'caja_origen_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  SELECT moneda INTO v_caja_destino_moneda FROM public.cajas WHERE id = p_caja_destino_id AND activo;
  IF v_caja_destino_moneda IS NULL THEN
    RAISE EXCEPTION 'caja_destino_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  IF v_caja_origen_moneda <> v_caja_destino_moneda THEN
    RAISE EXCEPTION 'monedas_diferentes: usar conversion explicita' USING ERRCODE = '22023';
  END IF;

  -- Out (caja origen)
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    transferencia_pair_id, estado, origen, created_by
  ) VALUES (
    p_caja_origen_id, p_fecha, 'transferencia_out', p_monto,
    COALESCE(p_descripcion, 'Transferencia salida'), p_referencia,
    v_pair_id, 'identificado', 'transferencia', auth.uid()
  );

  -- In (caja destino)
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    transferencia_pair_id, estado, origen, created_by
  ) VALUES (
    p_caja_destino_id, p_fecha, 'transferencia_in', p_monto,
    COALESCE(p_descripcion, 'Transferencia entrada'), p_referencia,
    v_pair_id, 'identificado', 'transferencia', auth.uid()
  );

  RETURN v_pair_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_crear_transferencia(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_crear_transferencia(uuid, uuid, numeric, date, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3) Revertir movimiento (contrasiento)
-- ────────────────────────────────────────────────────────────────
-- Genera un movimiento espejo con origen='reversion' y movimiento_revertido_id
-- apuntando al original. Si el original era ingreso/transferencia_in → la
-- reversión es egreso/transferencia_out (y viceversa). El monto y caja son
-- iguales. Las imputaciones del original se eliminan (el trigger recalcula
-- saldos de comprobantes).
--
-- Si el original ya fue revertido (revertido_at NOT NULL), error.
-- Si es parte de una transferencia, se REVIERTE LA PAREJA completa (ambas
-- patas).

CREATE OR REPLACE FUNCTION public.fz_revertir_movimiento(
  p_movimiento_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS uuid -- id del primer contrasiento creado
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mov record;
  v_par record;
  v_tipo_reverso text;
  v_nueva_id uuid;
  v_nueva_par_id uuid;
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

  v_tipo_reverso := CASE v_mov.tipo
    WHEN 'ingreso'            THEN 'egreso'
    WHEN 'egreso'             THEN 'ingreso'
    WHEN 'transferencia_in'   THEN 'transferencia_out'
    WHEN 'transferencia_out'  THEN 'transferencia_in'
  END;

  -- Borrar imputaciones del original (trigger recalcula saldos comprobante).
  DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;

  -- Crear contrasiento del original.
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen,
    movimiento_revertido_id, created_by
  ) VALUES (
    v_mov.caja_id, CURRENT_DATE, v_tipo_reverso, v_mov.monto,
    'Reversión de movimiento del ' || to_char(v_mov.fecha, 'DD/MM/YYYY')
      || CASE WHEN p_motivo IS NOT NULL THEN ' · ' || p_motivo ELSE '' END,
    v_mov.referencia, v_mov.administracion_id, v_mov.consorcio_id,
    'identificado', 'reversion', p_movimiento_id, auth.uid()
  )
  RETURNING id INTO v_nueva_id;

  -- Marcar original como revertido.
  UPDATE public.movimientos
     SET revertido_at = now(), updated_at = now()
   WHERE id = p_movimiento_id;

  -- Si es una transferencia, revertir la pareja también.
  IF v_mov.transferencia_pair_id IS NOT NULL THEN
    SELECT * INTO v_par
      FROM public.movimientos
     WHERE transferencia_pair_id = v_mov.transferencia_pair_id
       AND id <> p_movimiento_id
       AND revertido_at IS NULL
     FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = v_par.id;
      v_tipo_reverso := CASE v_par.tipo
        WHEN 'transferencia_in'   THEN 'transferencia_out'
        WHEN 'transferencia_out'  THEN 'transferencia_in'
        ELSE v_par.tipo
      END;
      INSERT INTO public.movimientos (
        caja_id, fecha, tipo, monto, descripcion, referencia,
        estado, origen, movimiento_revertido_id, created_by
      ) VALUES (
        v_par.caja_id, CURRENT_DATE, v_tipo_reverso, v_par.monto,
        'Reversión de transferencia · pareja',
        v_par.referencia, 'identificado', 'reversion', v_par.id, auth.uid()
      )
      RETURNING id INTO v_nueva_par_id;
      UPDATE public.movimientos
         SET revertido_at = now(), updated_at = now()
       WHERE id = v_par.id;
    END IF;
  END IF;

  RETURN v_nueva_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_revertir_movimiento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_revertir_movimiento(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4) Anular movimiento (soft delete)
-- ────────────────────────────────────────────────────────────────
-- Cambia estado a 'anulado' (NO impacta saldo gracias a filtro en VIEW).
-- Para movimientos que nunca debieron crearse (typo, duplicado obvio sin
-- impacto en saldo aún). NO se puede anular si ya tiene imputaciones.

CREATE OR REPLACE FUNCTION public.fz_anular_movimiento(
  p_movimiento_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'movimiento_con_imputaciones_usar_revertir' USING ERRCODE = '22023';
  END IF;

  UPDATE public.movimientos
     SET estado = 'anulado',
         motivo_pendiente = COALESCE(p_motivo, motivo_pendiente),
         updated_at = now()
   WHERE id = p_movimiento_id
     AND estado <> 'anulado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente_o_ya_anulado' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_anular_movimiento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_anular_movimiento(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 5) KPIs del dashboard
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_dashboard_kpis()
RETURNS TABLE (
  saldo_total numeric,
  ingresos_mes numeric,
  egresos_mes numeric,
  movs_pendientes integer,
  cajas_activas integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT SUM(saldo) FROM public.cajas_con_saldo WHERE activo), 0),
    COALESCE((
      SELECT SUM(monto) FROM public.movimientos
       WHERE estado = 'identificado'
         AND tipo = 'ingreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
    ), 0),
    COALESCE((
      SELECT SUM(monto) FROM public.movimientos
       WHERE estado = 'identificado'
         AND tipo = 'egreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
    ), 0),
    (SELECT COUNT(*)::int FROM public.movimientos WHERE estado = 'pendiente_id'),
    (SELECT COUNT(*)::int FROM public.cajas WHERE activo)
  WHERE private.is_staff();
$$;
REVOKE EXECUTE ON FUNCTION public.fz_dashboard_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_dashboard_kpis() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 6) Listado paginado con filtros
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_listar_movimientos(
  p_caja_id uuid DEFAULT NULL,
  p_tipo text DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_incluir_anulados boolean DEFAULT false,
  p_incluir_revertidos boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid,
  caja_id uuid,
  caja_nombre text,
  caja_color text,
  fecha date,
  tipo text,
  monto numeric,
  categoria_id uuid,
  categoria_nombre text,
  descripcion text,
  referencia text,
  administracion_id uuid,
  administracion_nombre text,
  estado text,
  origen text,
  revertido_at timestamptz,
  transferencia_pair_id uuid,
  movimiento_revertido_id uuid,
  total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT
      m.id, m.caja_id, c.nombre AS caja_nombre, c.color AS caja_color,
      m.fecha, m.tipo, m.monto, m.categoria_id,
      cat.nombre AS categoria_nombre,
      m.descripcion, m.referencia,
      m.administracion_id, a.nombre AS administracion_nombre,
      m.estado, m.origen, m.revertido_at,
      m.transferencia_pair_id, m.movimiento_revertido_id
    FROM public.movimientos m
    JOIN public.cajas c ON c.id = m.caja_id
    LEFT JOIN public.categorias_finanzas cat ON cat.id = m.categoria_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE private.is_staff()
      AND (p_caja_id IS NULL OR m.caja_id = p_caja_id)
      AND (p_tipo IS NULL OR m.tipo = p_tipo)
      AND (p_fecha_desde IS NULL OR m.fecha >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR m.fecha <= p_fecha_hasta)
      AND (p_incluir_anulados OR m.estado <> 'anulado')
      AND (p_incluir_revertidos OR m.revertido_at IS NULL)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR m.descripcion ILIKE '%'||p_search||'%'
        OR m.referencia ILIKE '%'||p_search||'%'
        OR a.nombre ILIKE '%'||p_search||'%'
      )
  ),
  with_count AS (
    SELECT *, COUNT(*) OVER() AS total_count FROM filtered
  )
  SELECT * FROM with_count
  ORDER BY fecha DESC, id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$$;
REVOKE EXECUTE ON FUNCTION public.fz_listar_movimientos(uuid, text, date, date, text, boolean, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_listar_movimientos(uuid, text, date, date, text, boolean, boolean, integer, integer) TO authenticated;

COMMIT;
