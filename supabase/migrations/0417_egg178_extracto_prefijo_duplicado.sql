-- ============================================================================
-- 0417 · E-GG-178 (parte 2) — Extracto: prefijo "Cobranza · Cobranza · …"
--
-- Hallazgo derivado del caso Drozd: `cuenta_corriente_extracto` compone las
-- filas de abono como 'Cobranza' || ' · ' || m.descripcion. Como el wizard (y
-- ahora también la RPC, mig 0416) guardan la descripción con el prefijo
-- "Cobranza · ", el extracto de gerencia Y del cliente (cliente_ctacte_extracto
-- delega acá) mostraba "Cobranza · Cobranza · Curso …" — pre-existente para
-- TODAS las cobranzas del wizard, verificado en vivo con el extracto real.
--
-- Fix: al componer, se le quita a m.descripcion el prefijo "Cobranza · " si ya
-- lo trae (regexp anclada al inicio). Aplica a 'abono' y a 'saldo_favor'
-- ("Saldo a favor · Cobranza · X" → "Saldo a favor · X"). La descripción
-- guardada en el movimiento NO cambia (la caja sigue mostrando lo suyo).
--
-- R16: misma firma (uuid, date, date) → CREATE OR REPLACE sin overload.
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
        || CASE WHEN det.detalle IS NOT NULL THEN ' · ' || det.detalle ELSE '' END
      ) AS b_descripcion,
      c.total::numeric AS b_debe, 0::numeric AS b_haber,
      c.id AS b_comprobante_id, NULL::uuid AS b_movimiento_id,
      NULL::uuid AS b_imputacion_id, cons.nombre AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
      ) x
    ) det ON true
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta

    UNION ALL

    SELECT
      m.fecha, 'abono'::text, 1::int,
      (
        'Cobranza'
        -- E-GG-178: si la descripción ya viene como "Cobranza · X", se
        -- muestra "Cobranza · X" y no "Cobranza · Cobranza · X".
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza\s*·\s*', ''), ''), '')
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
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza\s*·\s*', ''), ''), ' · pago no imputado')
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
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
          FROM public.comprobantes c
         WHERE c.id = m.comprobante_id
           AND c.administracion_id = p_administracion_id
      ) x
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
