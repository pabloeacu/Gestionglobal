-- ============================================================================
-- 0059_finanzas_reportes · DGG-23 Bloque 3.B
--
-- 4 RPCs de reportes financieros:
--   · fz_reporte_flujo_caja    → 12 meses ingresos/egresos/saldo acumulado
--   · fz_reporte_balance_mensual → por caja: 12 meses inicial/in/out/final
--   · fz_reporte_pyg           → estado de resultados por categoría
--   · fz_reporte_comparativo   → mismo mes año vs año anterior
--
-- Excluye movimientos anulados Y reversiones (regla E-GG-19): los reportes
-- muestran el flujo real, no contrasientos administrativos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Flujo de caja · 12 meses · ingresos/egresos/saldo acumulado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_reporte_flujo_caja(
  p_anio int DEFAULT NULL,
  p_caja_id uuid DEFAULT NULL
) RETURNS TABLE (
  mes_num int,
  mes_label text,
  mes_inicio date,
  ingresos numeric,
  egresos numeric,
  neto numeric,
  saldo_acumulado numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anio int := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_saldo_inicial numeric := 0;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede ver reportes';
  END IF;

  -- Saldo de arranque al 31-dic del año anterior (todo lo previo, sin reversiones ni anulados)
  SELECT COALESCE(SUM(
    CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto
         WHEN m.tipo IN ('egreso','transferencia_out') THEN -m.monto
         ELSE 0 END
  ), 0)
  INTO v_saldo_inicial
  FROM public.movimientos m
  WHERE m.estado <> 'anulado'
    AND m.origen <> 'reversion'
    AND m.fecha < make_date(v_anio, 1, 1)
    AND (p_caja_id IS NULL OR m.caja_id = p_caja_id);

  RETURN QUERY
  WITH meses AS (
    SELECT generate_series(1, 12) AS mes_num,
           ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']::text[] AS labels
  ),
  agg AS (
    SELECT
      EXTRACT(MONTH FROM m.fecha)::int AS mes_num,
      SUM(CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN m.tipo IN ('egreso','transferencia_out') THEN m.monto ELSE 0 END) AS egresos
    FROM public.movimientos m
    WHERE m.estado <> 'anulado'
      AND m.origen <> 'reversion'
      AND EXTRACT(YEAR FROM m.fecha) = v_anio
      AND (p_caja_id IS NULL OR m.caja_id = p_caja_id)
    GROUP BY EXTRACT(MONTH FROM m.fecha)
  ),
  combinado AS (
    SELECT
      m.mes_num,
      m.labels[m.mes_num] AS mes_label,
      make_date(v_anio, m.mes_num, 1) AS mes_inicio,
      COALESCE(a.ingresos, 0)::numeric AS ingresos,
      COALESCE(a.egresos, 0)::numeric AS egresos,
      (COALESCE(a.ingresos, 0) - COALESCE(a.egresos, 0))::numeric AS neto
    FROM meses m
    LEFT JOIN agg a ON a.mes_num = m.mes_num
    ORDER BY m.mes_num
  )
  SELECT
    c.mes_num,
    c.mes_label,
    c.mes_inicio,
    c.ingresos,
    c.egresos,
    c.neto,
    (v_saldo_inicial + SUM(c.neto) OVER (ORDER BY c.mes_num))::numeric AS saldo_acumulado
  FROM combinado c
  ORDER BY c.mes_num;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Balance mensual por caja · saldo inicial/in/out/final por mes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_reporte_balance_mensual(
  p_anio int DEFAULT NULL,
  p_solo_activas boolean DEFAULT true
) RETURNS TABLE (
  caja_id uuid,
  caja_nombre text,
  caja_tipo text,
  caja_color text,
  mes_num int,
  mes_label text,
  saldo_inicial numeric,
  ingresos numeric,
  egresos numeric,
  saldo_final numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anio int := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede ver reportes';
  END IF;

  RETURN QUERY
  WITH cajas_filtradas AS (
    SELECT c.id, c.nombre, c.tipo, c.color
    FROM public.cajas c
    WHERE (NOT p_solo_activas OR c.activo)
  ),
  meses AS (
    SELECT generate_series(1, 12) AS mes_num,
           ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']::text[] AS labels
  ),
  cajas_meses AS (
    SELECT cf.id AS caja_id, cf.nombre, cf.tipo, cf.color,
           m.mes_num, m.labels[m.mes_num] AS mes_label
    FROM cajas_filtradas cf CROSS JOIN meses m
  ),
  -- Saldo inicial: TODO lo anterior al primer día del mes
  saldos AS (
    SELECT
      cm.caja_id, cm.nombre, cm.tipo, cm.color, cm.mes_num, cm.mes_label,
      (SELECT COALESCE(SUM(
        CASE WHEN mov.tipo IN ('ingreso','transferencia_in') THEN mov.monto
             WHEN mov.tipo IN ('egreso','transferencia_out') THEN -mov.monto
             ELSE 0 END
      ), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id
         AND mov.estado <> 'anulado'
         AND mov.origen <> 'reversion'
         AND mov.fecha < make_date(v_anio, cm.mes_num, 1)
      ) AS saldo_inicial,
      (SELECT COALESCE(SUM(CASE WHEN mov.tipo IN ('ingreso','transferencia_in') THEN mov.monto ELSE 0 END), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id
         AND mov.estado <> 'anulado'
         AND mov.origen <> 'reversion'
         AND EXTRACT(YEAR FROM mov.fecha) = v_anio
         AND EXTRACT(MONTH FROM mov.fecha) = cm.mes_num
      ) AS ingresos,
      (SELECT COALESCE(SUM(CASE WHEN mov.tipo IN ('egreso','transferencia_out') THEN mov.monto ELSE 0 END), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id
         AND mov.estado <> 'anulado'
         AND mov.origen <> 'reversion'
         AND EXTRACT(YEAR FROM mov.fecha) = v_anio
         AND EXTRACT(MONTH FROM mov.fecha) = cm.mes_num
      ) AS egresos
    FROM cajas_meses cm
  )
  SELECT
    s.caja_id, s.nombre AS caja_nombre, s.tipo AS caja_tipo, s.color AS caja_color,
    s.mes_num, s.mes_label,
    s.saldo_inicial::numeric,
    s.ingresos::numeric,
    s.egresos::numeric,
    (s.saldo_inicial + s.ingresos - s.egresos)::numeric AS saldo_final
  FROM saldos s
  ORDER BY s.nombre, s.mes_num;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. P&L · estado de resultados por categoría
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_reporte_pyg(
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS TABLE (
  categoria_id uuid,
  categoria_nombre text,
  categoria_tipo text,
  categoria_color text,
  tipo_movimiento text,  -- 'ingreso' | 'egreso'
  cantidad_movimientos bigint,
  total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde date := COALESCE(p_desde, date_trunc('year', CURRENT_DATE)::date);
  v_hasta date := COALESCE(p_hasta, CURRENT_DATE);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede ver reportes';
  END IF;

  RETURN QUERY
  SELECT
    cf.id AS categoria_id,
    cf.nombre AS categoria_nombre,
    cf.tipo AS categoria_tipo,
    cf.color AS categoria_color,
    m.tipo AS tipo_movimiento,
    COUNT(*)::bigint AS cantidad_movimientos,
    SUM(m.monto)::numeric AS total
  FROM public.movimientos m
  LEFT JOIN public.categorias_finanzas cf ON cf.id = m.categoria_id
  WHERE m.estado <> 'anulado'
    AND m.origen <> 'reversion'
    AND m.tipo IN ('ingreso','egreso')  -- transferencias no afectan P&L
    AND m.fecha BETWEEN v_desde AND v_hasta
  GROUP BY cf.id, cf.nombre, cf.tipo, cf.color, m.tipo
  ORDER BY m.tipo, total DESC NULLS LAST;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Comparativo año vs año
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_reporte_comparativo(
  p_anio int DEFAULT NULL
) RETURNS TABLE (
  mes_num int,
  mes_label text,
  ingresos_actual numeric,
  ingresos_anterior numeric,
  ingresos_var_pct numeric,
  egresos_actual numeric,
  egresos_anterior numeric,
  egresos_var_pct numeric,
  neto_actual numeric,
  neto_anterior numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anio int := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_anio_prev int := v_anio - 1;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede ver reportes';
  END IF;

  RETURN QUERY
  WITH meses AS (
    SELECT generate_series(1, 12) AS mes_num,
           ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']::text[] AS labels
  ),
  agg_actual AS (
    SELECT
      EXTRACT(MONTH FROM m.fecha)::int AS mes_num,
      SUM(CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN m.tipo = 'egreso' THEN m.monto ELSE 0 END) AS egresos
    FROM public.movimientos m
    WHERE m.estado <> 'anulado'
      AND m.origen <> 'reversion'
      AND m.tipo IN ('ingreso','egreso')
      AND EXTRACT(YEAR FROM m.fecha) = v_anio
    GROUP BY EXTRACT(MONTH FROM m.fecha)
  ),
  agg_prev AS (
    SELECT
      EXTRACT(MONTH FROM m.fecha)::int AS mes_num,
      SUM(CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN m.tipo = 'egreso' THEN m.monto ELSE 0 END) AS egresos
    FROM public.movimientos m
    WHERE m.estado <> 'anulado'
      AND m.origen <> 'reversion'
      AND m.tipo IN ('ingreso','egreso')
      AND EXTRACT(YEAR FROM m.fecha) = v_anio_prev
    GROUP BY EXTRACT(MONTH FROM m.fecha)
  )
  SELECT
    m.mes_num,
    m.labels[m.mes_num] AS mes_label,
    COALESCE(a.ingresos, 0)::numeric AS ingresos_actual,
    COALESCE(p.ingresos, 0)::numeric AS ingresos_anterior,
    CASE
      WHEN COALESCE(p.ingresos, 0) = 0 THEN NULL
      ELSE ROUND(((COALESCE(a.ingresos, 0) - COALESCE(p.ingresos, 0)) / NULLIF(p.ingresos, 0) * 100)::numeric, 1)
    END AS ingresos_var_pct,
    COALESCE(a.egresos, 0)::numeric AS egresos_actual,
    COALESCE(p.egresos, 0)::numeric AS egresos_anterior,
    CASE
      WHEN COALESCE(p.egresos, 0) = 0 THEN NULL
      ELSE ROUND(((COALESCE(a.egresos, 0) - COALESCE(p.egresos, 0)) / NULLIF(p.egresos, 0) * 100)::numeric, 1)
    END AS egresos_var_pct,
    (COALESCE(a.ingresos, 0) - COALESCE(a.egresos, 0))::numeric AS neto_actual,
    (COALESCE(p.ingresos, 0) - COALESCE(p.egresos, 0))::numeric AS neto_anterior
  FROM meses m
  LEFT JOIN agg_actual a ON a.mes_num = m.mes_num
  LEFT JOIN agg_prev p ON p.mes_num = m.mes_num
  ORDER BY m.mes_num;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fz_reporte_flujo_caja FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_reporte_balance_mensual FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_reporte_pyg FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_reporte_comparativo FROM public, anon;

GRANT EXECUTE ON FUNCTION public.fz_reporte_flujo_caja TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_reporte_balance_mensual TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_reporte_pyg TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_reporte_comparativo TO authenticated;
