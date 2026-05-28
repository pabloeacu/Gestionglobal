-- ============================================================================
-- Migration: 0112_fix_cuenta_corriente_orden_cargo_abono
-- Fecha: 2026-05-28
-- DGG-XX · Bug walkthrough: la CC del cliente mostraba "Saldo actual $45.000"
-- cuando la cuenta estaba saldada ($0), y los saldos del 28/may aparecían
-- descalibrados (abono $0 ANTES de cargo $12.750 con saldo $12.750).
--
-- Root cause:
--   * row_number() para el running balance ordenaba por (fecha, created_at)
--   * el ORDER BY final usaba (fecha, tipo) — alfabético: 'abono' < 'cargo'
--   * resultado: el saldo se computaba con cargo→abono pero se MOSTRABA con
--     abono→cargo, generando saldos descolgados y un "saldo final" engañoso.
--
-- Fix:
--   * agregamos b_tipo_ord (0=cargo, 1=abono) para forzar cargo ANTES de abono
--     en el mismo día.
--   * tanto row_number() como ORDER BY final usan rn → display y running
--     balance quedan sincronizados.
--   * saldo_inicial se mueve via columna sort=0 al frente.
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
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
      0::int              AS b_tipo_ord,   -- cargo precede abono mismo día
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
      m.fecha, 'abono'::text, 1::int,
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
    SELECT
      base.*,
      row_number() OVER (
        ORDER BY base.b_fecha ASC, base.b_tipo_ord ASC, base.b_ord ASC
      ) AS rn
    FROM base
  ),
  final_q AS (
    SELECT
      p_desde            AS f_fecha,
      'saldo_inicial'::text AS f_tipo,
      'Saldo anterior'::text AS f_descripcion,
      0::numeric         AS f_debe,
      0::numeric         AS f_haber,
      v_saldo_inicial    AS f_saldo,
      NULL::uuid         AS f_comprobante_id,
      NULL::uuid         AS f_movimiento_id,
      NULL::uuid         AS f_imputacion_id,
      NULL::text         AS f_consorcio_nombre,
      0::bigint          AS f_sort
    UNION ALL
    SELECT
      o.b_fecha, o.b_tipo, o.b_descripcion,
      o.b_debe, o.b_haber,
      v_saldo_inicial + SUM(o.b_debe - o.b_haber) OVER (ORDER BY o.rn),
      o.b_comprobante_id, o.b_movimiento_id, o.b_imputacion_id,
      o.b_consorcio_nombre,
      o.rn::bigint
    FROM ordered o
  )
  SELECT
    f_fecha, f_tipo, f_descripcion, f_debe, f_haber, f_saldo,
    f_comprobante_id, f_movimiento_id, f_imputacion_id, f_consorcio_nombre
  FROM final_q
  ORDER BY f_sort ASC;
END;
$$;
