-- ============================================================================
-- 0031_ctacte_rpcs · RPCs de UI de Cuenta Corriente (subsistema gerencia).
--   - cuenta_corriente_resumen(admin_id, desde, hasta)
--   - cuenta_corriente_extracto(admin_id, desde, hasta)
--   - cuenta_corriente_morosos(limit)
--   - cuenta_corriente_resumen_global(desde, hasta)
--
-- Diseño:
--   - SECURITY DEFINER + SET search_path = public, pg_temp (regla 5/6).
--   - assert_administracion_access(admin_id) en RPCs por administración
--     (regla 12); las globales chequean `private.is_staff()` o
--     `private.is_gerente()` según corresponda.
--   - El "extracto" reconstruye los apuntes: cargo = total del comprobante
--     en su fecha de emisión, abono = imputación contra ese comprobante en
--     la fecha del movimiento. No se inventan saldos iniciales: si hay
--     rango, se calcula el saldo previo a `p_desde` y se devuelve como
--     fila sintética inicial "Saldo anterior".
--   - Filtra estados: ignora comprobantes 'anulado' y 'borrador'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cuenta_corriente_resumen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen(
  p_administracion_id uuid,
  p_desde date DEFAULT (current_date - interval '1 year')::date,
  p_hasta date DEFAULT current_date
) RETURNS TABLE (
  saldo_inicial          numeric,
  total_facturado        numeric,
  total_cobrado          numeric,
  saldo_actual           numeric,
  comprobantes_pendientes int,
  comprobantes_vencidos  int,
  deuda_total            numeric,
  proximo_vencimiento    date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  RETURN QUERY
  WITH
  -- Cargos previos al rango (comprobantes no anulados con fecha < desde)
  cargos_prev AS (
    SELECT COALESCE(SUM(total), 0) AS x
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador')
      AND fecha < p_desde
  ),
  -- Abonos previos: imputaciones cuya fecha de movimiento es anterior al rango
  abonos_prev AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha < p_desde
      AND m.estado = 'identificado'
  ),
  cargos_rango AS (
    SELECT COALESCE(SUM(total), 0) AS x
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador')
      AND fecha BETWEEN p_desde AND p_hasta
  ),
  abonos_rango AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
  ),
  saldos_actuales AS (
    SELECT
      COALESCE(SUM(saldo_pendiente), 0) AS deuda_total,
      COUNT(*) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial')
      )::int AS pendientes,
      COUNT(*) FILTER (
        WHERE estado_cobranza = 'vencido'
      )::int AS vencidos,
      MIN(vencimiento) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial')
          AND vencimiento >= current_date
      ) AS proximo
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador')
  )
  SELECT
    (cargos_prev.x - abonos_prev.x)                  AS saldo_inicial,
    cargos_rango.x                                   AS total_facturado,
    abonos_rango.x                                   AS total_cobrado,
    (cargos_prev.x - abonos_prev.x + cargos_rango.x - abonos_rango.x)
                                                     AS saldo_actual,
    saldos_actuales.pendientes,
    saldos_actuales.vencidos,
    saldos_actuales.deuda_total,
    saldos_actuales.proximo
  FROM cargos_prev, abonos_prev, cargos_rango, abonos_rango, saldos_actuales;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cuenta_corriente_resumen(uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_resumen(uuid, date, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- cuenta_corriente_extracto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(
  p_administracion_id uuid,
  p_desde date,
  p_hasta date
) RETURNS TABLE (
  fecha            date,
  tipo             text,           -- 'saldo_inicial' | 'cargo' | 'abono'
  descripcion      text,
  debe             numeric,
  haber            numeric,
  saldo            numeric,
  comprobante_id   uuid,
  movimiento_id    uuid,
  imputacion_id    uuid,
  consorcio_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saldo_inicial numeric;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  -- saldo previo a p_desde
  SELECT
    COALESCE((
      SELECT SUM(total) FROM public.comprobantes
      WHERE administracion_id = p_administracion_id
        AND estado NOT IN ('anulado','borrador')
        AND fecha < p_desde
    ), 0)
    -
    COALESCE((
      SELECT SUM(mi.monto_imputado)
      FROM public.movimiento_imputaciones mi
      JOIN public.movimientos m ON m.id = mi.movimiento_id
      JOIN public.comprobantes c ON c.id = mi.comprobante_id
      WHERE c.administracion_id = p_administracion_id
        AND m.fecha < p_desde
        AND m.estado = 'identificado'
    ), 0)
  INTO v_saldo_inicial;

  RETURN QUERY
  WITH base AS (
    -- Cargos: comprobantes emitidos (fecha entre desde y hasta)
    SELECT
      c.fecha,
      'cargo'::text AS tipo,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0')
                ELSE '' END
        || CASE WHEN c.concepto IS NOT NULL
                THEN ' · ' || c.concepto ELSE '' END
      ) AS descripcion,
      c.total::numeric  AS debe,
      0::numeric        AS haber,
      c.id              AS comprobante_id,
      NULL::uuid        AS movimiento_id,
      NULL::uuid        AS imputacion_id,
      cons.nombre       AS consorcio_nombre,
      c.created_at::timestamptz AS ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta
    UNION ALL
    -- Abonos: imputaciones contra comprobantes de la admin (mov entre desde y hasta)
    SELECT
      m.fecha,
      'abono'::text,
      (
        'Cobranza'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), '')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
      ) AS descripcion,
      0::numeric,
      mi.monto_imputado::numeric,
      c.id,
      m.id,
      mi.id,
      cons.nombre,
      m.created_at::timestamptz
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
  ),
  ordered AS (
    SELECT *,
      row_number() OVER (ORDER BY fecha ASC, ord ASC) AS rn
    FROM base
  )
  SELECT
    p_desde, 'saldo_inicial'::text, 'Saldo anterior'::text,
    0::numeric, 0::numeric, v_saldo_inicial,
    NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
  UNION ALL
  SELECT
    o.fecha, o.tipo, o.descripcion,
    o.debe, o.haber,
    v_saldo_inicial + SUM(o.debe - o.haber) OVER (ORDER BY o.rn) AS saldo,
    o.comprobante_id, o.movimiento_id, o.imputacion_id, o.consorcio_nombre
  FROM ordered o
  ORDER BY 1, 2;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cuenta_corriente_extracto(uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_extracto(uuid, date, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- cuenta_corriente_morosos · top morosos para dashboard de gerencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuenta_corriente_morosos(
  p_limit int DEFAULT 10
) RETURNS TABLE (
  administracion_id   uuid,
  administracion_nombre text,
  deuda_total         numeric,
  comprobantes_vencidos int,
  comprobantes_pendientes int,
  mayor_dias_vencido  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar morosos';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.nombre,
    COALESCE(SUM(c.saldo_pendiente), 0)::numeric AS deuda_total,
    COUNT(*) FILTER (WHERE c.estado_cobranza = 'vencido')::int,
    COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int,
    COALESCE(MAX(
      CASE WHEN c.estado_cobranza = 'vencido' AND c.vencimiento IS NOT NULL
           THEN (current_date - c.vencimiento)::int
           ELSE 0 END
    ), 0)::int
  FROM public.administraciones a
  JOIN public.comprobantes c ON c.administracion_id = a.id
  WHERE c.estado NOT IN ('anulado','borrador')
    AND c.saldo_pendiente > 0
  GROUP BY a.id, a.nombre
  HAVING COALESCE(SUM(c.saldo_pendiente), 0) > 0
  ORDER BY deuda_total DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cuenta_corriente_morosos(int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_morosos(int)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- cuenta_corriente_resumen_global · totales por administración (gerencia).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen_global(
  p_desde date DEFAULT (current_date - interval '1 year')::date,
  p_hasta date DEFAULT current_date
) RETURNS TABLE (
  administracion_id     uuid,
  administracion_nombre text,
  total_facturado       numeric,
  total_cobrado         numeric,
  deuda_total           numeric,
  comprobantes_vencidos int,
  comprobantes_pendientes int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar el resumen global';
  END IF;

  -- Aliases `aid` para evitar ambigüedad con la columna OUT del RETURNS TABLE.
  RETURN QUERY
  WITH cargos AS (
    SELECT c.administracion_id AS aid, SUM(c.total) AS x
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta
    GROUP BY c.administracion_id
  ),
  abonos AS (
    SELECT c.administracion_id AS aid, SUM(mi.monto_imputado) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
    GROUP BY c.administracion_id
  ),
  deudas AS (
    SELECT
      c.administracion_id AS aid,
      SUM(c.saldo_pendiente) AS deuda,
      COUNT(*) FILTER (WHERE c.estado_cobranza = 'vencido')::int AS vencidos,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pendientes
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador')
    GROUP BY c.administracion_id
  )
  SELECT
    a.id,
    a.nombre,
    COALESCE(cargos.x, 0)::numeric,
    COALESCE(abonos.x, 0)::numeric,
    COALESCE(deudas.deuda, 0)::numeric,
    COALESCE(deudas.vencidos, 0),
    COALESCE(deudas.pendientes, 0)
  FROM public.administraciones a
  LEFT JOIN cargos ON cargos.aid = a.id
  LEFT JOIN abonos ON abonos.aid = a.id
  LEFT JOIN deudas ON deudas.aid = a.id
  WHERE a.activo = true
    AND (
      COALESCE(cargos.x, 0) > 0
      OR COALESCE(abonos.x, 0) > 0
      OR COALESCE(deudas.deuda, 0) > 0
    )
  ORDER BY COALESCE(deudas.deuda, 0) DESC, a.nombre ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cuenta_corriente_resumen_global(date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_resumen_global(date, date)
  TO authenticated;
