-- ============================================================================
-- Migration: 0108_fix_cuenta_corriente_extracto_fecha_ambig
-- Fecha: 2026-05-28
-- DGG-XX · Walkthrough e2e detectó: la RPC cuenta_corriente_extracto
-- RETURNS TABLE(fecha date, ...) chocaba con columna comprobantes.fecha en
-- el subquery del saldo inicial → 42702 "column reference fecha is ambiguous".
-- El front no sabía interpretar el error y mostraba "Cuenta corriente vacía".
-- Prefijamos todas las referencias y renombramos columnas del CTE base con
-- prefijo b_ para no chocar con las OUT columns.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(
  p_administracion_id uuid,
  p_desde date,
  p_hasta date
)
RETURNS TABLE(
  fecha date, tipo text, descripcion text,
  debe numeric, haber numeric, saldo numeric,
  comprobante_id uuid, movimiento_id uuid, imputacion_id uuid,
  consorcio_nombre text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_saldo_inicial numeric;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  SELECT
    COALESCE((
      SELECT SUM(c.total)
        FROM public.comprobantes c
       WHERE c.administracion_id = p_administracion_id
         AND c.estado NOT IN ('anulado','borrador')
         AND c.fecha < p_desde
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
    SELECT
      c.fecha             AS b_fecha,
      'cargo'::text       AS b_tipo,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0')
                ELSE '' END
        || CASE WHEN c.concepto IS NOT NULL
                THEN ' · ' || c.concepto ELSE '' END
      )                   AS b_descripcion,
      c.total::numeric    AS b_debe,
      0::numeric          AS b_haber,
      c.id                AS b_comprobante_id,
      NULL::uuid          AS b_movimiento_id,
      NULL::uuid          AS b_imputacion_id,
      cons.nombre         AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT
      m.fecha, 'abono'::text,
      (
        'Cobranza'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), '')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
      ),
      0::numeric, mi.monto_imputado::numeric,
      c.id, m.id, mi.id,
      cons.nombre, m.created_at::timestamptz
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
  ),
  ordered AS (
    SELECT base.*, row_number() OVER (ORDER BY base.b_fecha ASC, base.b_ord ASC) AS rn
      FROM base
  )
  SELECT
    p_desde AS fecha, 'saldo_inicial'::text AS tipo,
    'Saldo anterior'::text AS descripcion,
    0::numeric AS debe, 0::numeric AS haber, v_saldo_inicial AS saldo,
    NULL::uuid AS comprobante_id, NULL::uuid AS movimiento_id,
    NULL::uuid AS imputacion_id, NULL::text AS consorcio_nombre
  UNION ALL
  SELECT
    o.b_fecha, o.b_tipo, o.b_descripcion,
    o.b_debe, o.b_haber,
    v_saldo_inicial + SUM(o.b_debe - o.b_haber) OVER (ORDER BY o.rn),
    o.b_comprobante_id, o.b_movimiento_id, o.b_imputacion_id, o.b_consorcio_nombre
  FROM ordered o
  ORDER BY 1, 2;
END;
$$;
