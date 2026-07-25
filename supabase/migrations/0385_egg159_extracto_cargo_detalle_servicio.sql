-- ============================================================================
-- 0385 · E-GG-159 (reporte de JL vía Pablo, 24/07)
--
-- La línea de CARGO del extracto de cuenta corriente mostraba el CONCEPTO
-- FISCAL del comprobante ("X 00001-00000006 · servicios") en vez de QUÉ
-- servicio se contrató. Facturación se veía bien porque muestra las líneas
-- de detalle. Canon de Pablo: una única fuente de verdad — todas las
-- superficies deben dejar constancia del servicio contratado.
--
-- Fix: el branch del cargo usa la MISMA cascada canónica que ya usaba el
-- branch "Saldo a favor" (W8-2 / E-GG-116):
--   1. servicios.nombre (si el comprobante tiene servicio_id)
--   2. string_agg de items_comprobantes.descripcion (el detalle facturado)
--   3. tramites.titulo (si nació de un trámite)
--   4. concepto fiscal (último recurso, comprobantes viejos sin nada)
-- Como la descripción se deriva EN LECTURA, todos los históricos quedan
-- corregidos sin backfill, y gerencia + portal + PDF + extracto de orden
-- heredan el fix (todos consumen esta RPC).
--
-- Firma SIN cambios (mismos parámetros y RETURNS TABLE) → CREATE OR REPLACE
-- no genera overload (R16 no aplica; smoke de overloads igual en el cierre).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(p_administracion_id uuid, p_desde date, p_hasta date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric, saldo numeric, comprobante_id uuid, movimiento_id uuid, imputacion_id uuid, consorcio_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    - COALESCE((
      SELECT SUM(mi.monto_imputado)
        FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
        JOIN public.comprobantes c ON c.id = mi.comprobante_id
       WHERE c.administracion_id = p_administracion_id
         AND m.fecha < p_desde
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
    ), 0)
    - COALESCE((
      SELECT SUM(m.monto - COALESCE(imp.aplicado, 0))
        FROM public.movimientos m
        LEFT JOIN LATERAL (
          SELECT SUM(mi.monto_imputado) AS aplicado
            FROM public.movimiento_imputaciones mi
           WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
        ) imp ON true
       WHERE m.administracion_id = p_administracion_id
         AND m.tipo = 'ingreso'
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
         AND m.fecha < p_desde
         AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    ), 0)
  INTO v_saldo_inicial;

  RETURN QUERY
  WITH base AS (
    SELECT
      c.fecha AS b_fecha, 'cargo'::text AS b_tipo, 0::int AS b_tipo_ord,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0') ELSE '' END
        -- E-GG-159: QUÉ se contrató (cascada canónica), no el concepto fiscal.
        || CASE WHEN det.detalle IS NOT NULL THEN ' · ' || det.detalle ELSE '' END
      ) AS b_descripcion,
      c.total::numeric AS b_debe, 0::numeric AS b_haber,
      c.id AS b_comprobante_id, NULL::uuid AS b_movimiento_id,
      NULL::uuid AS b_imputacion_id, cons.nombre AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    LEFT JOIN LATERAL (
      SELECT left(COALESCE(
               (SELECT s.nombre FROM public.servicios s WHERE s.id = c.servicio_id),
               (SELECT string_agg(ic.descripcion, ' + ' ORDER BY ic.orden)
                  FROM public.items_comprobantes ic WHERE ic.comprobante_id = c.id),
               (SELECT t.titulo FROM public.tramites t
                 WHERE t.comprobante_id = c.id LIMIT 1),
               NULLIF(c.concepto, '')
             ), 160) AS detalle
    ) det ON true
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
      c.id, m.id, mi.id, cons.nombre, m.created_at::timestamptz
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL

    UNION ALL

    SELECT
      m.fecha, 'saldo_favor'::text, 2::int,
      (
        'Saldo a favor'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), ' · pago no imputado')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
        || COALESCE(' · origen: ' || ori.detalle, '')
      ),
      0::numeric,
      (m.monto - COALESCE(imp.aplicado, 0))::numeric,
      NULL::uuid, m.id, NULL::uuid, NULL::text, m.created_at::timestamptz
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado
        FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    LEFT JOIN LATERAL (
      SELECT left(COALESCE(
               (SELECT s.nombre FROM public.servicios s WHERE s.id = c.servicio_id),
               (SELECT string_agg(ic.descripcion, ' + ' ORDER BY ic.orden)
                  FROM public.items_comprobantes ic WHERE ic.comprobante_id = c.id),
               (SELECT t.titulo FROM public.tramites t
                 WHERE t.comprobante_id = c.id LIMIT 1),
               NULLIF(c.concepto, '')
             ), 160) AS detalle
        FROM public.comprobantes c
       WHERE c.id = m.comprobante_id
    ) ori ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo = 'ingreso'
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  ordered AS (
    SELECT base.*,
      row_number() OVER (ORDER BY base.b_fecha ASC, base.b_tipo_ord ASC, base.b_ord ASC) AS rn
    FROM base
  ),
  final_q AS (
    SELECT
      p_desde AS f_fecha, 'saldo_inicial'::text AS f_tipo,
      'Saldo anterior'::text AS f_descripcion,
      0::numeric AS f_debe, 0::numeric AS f_haber, v_saldo_inicial AS f_saldo,
      NULL::uuid AS f_comprobante_id, NULL::uuid AS f_movimiento_id,
      NULL::uuid AS f_imputacion_id, NULL::text AS f_consorcio_nombre,
      0::bigint AS f_sort
    UNION ALL
    SELECT
      o.b_fecha, o.b_tipo, o.b_descripcion, o.b_debe, o.b_haber,
      v_saldo_inicial + SUM(o.b_debe - o.b_haber) OVER (ORDER BY o.rn),
      o.b_comprobante_id, o.b_movimiento_id, o.b_imputacion_id,
      o.b_consorcio_nombre, o.rn::bigint
    FROM ordered o
  )
  SELECT f_fecha, f_tipo, f_descripcion, f_debe, f_haber, f_saldo,
         f_comprobante_id, f_movimiento_id, f_imputacion_id, f_consorcio_nombre
  FROM final_q
  ORDER BY f_sort ASC;
END;
$function$;
