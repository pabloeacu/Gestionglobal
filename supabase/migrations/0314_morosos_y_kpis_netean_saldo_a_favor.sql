-- 0314 · Auditoría proactiva (consistencia contable) · Morosos y el KPI de deuda
-- de la home mostraban deuda BRUTA (Σ saldo_pendiente) sin restar el crédito no
-- imputado (saldo a favor) que la fuente de verdad (cuenta_corriente_resumen)
-- SÍ netea. Efecto: un cliente con una factura vencida pero con más crédito a
-- favor aparece como MOROSO y el recupero lo intimaría — siendo que está a favor.
-- Con $860k de crédito vivo hoy, JL lo vería mañana. Fix: netear el crédito en
-- ambas RPCs (mismo cálculo de `creditos` que cuenta_corriente_resumen_global).
-- Misma firma → CREATE OR REPLACE (R16).

CREATE OR REPLACE FUNCTION public.cuenta_corriente_morosos(p_limit integer DEFAULT 10)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, deuda_total numeric,
   comprobantes_vencidos integer, comprobantes_pendientes integer, mayor_dias_vencido integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff puede consultar morosos'; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT a.id, a.nombre,
      COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta,
      COUNT(*) FILTER (WHERE c.estado_cobranza='vencido')::int AS venc,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pend,
      COALESCE(MAX(CASE WHEN c.estado_cobranza='vencido' AND c.vencimiento IS NOT NULL
                        THEN (current_date - c.vencimiento)::int ELSE 0 END),0)::int AS maxdias
    FROM public.administraciones a
    JOIN public.comprobantes c ON c.administracion_id=a.id
    WHERE c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente>0
    GROUP BY a.id, a.nombre
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado,0)) AS credito
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id=m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL AND m.tipo='ingreso'
      AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado,0)) > 0.001
    GROUP BY m.administracion_id
  )
  SELECT d.id, d.nombre,
    (d.deuda_bruta - COALESCE(cr.credito,0))::numeric,
    d.venc, d.pend, d.maxdias
  FROM deudas d
  LEFT JOIN creditos cr ON cr.aid=d.id
  WHERE (d.deuda_bruta - COALESCE(cr.credito,0)) > 0   -- excluye a los que están netos a favor
  ORDER BY (d.deuda_bruta - COALESCE(cr.credito,0)) DESC
  LIMIT GREATEST(p_limit,1);
END;
$function$;

-- KPIs de la home de gerencia: deuda_total neta + admins_morosos netos.
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(p_desde date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb; v_facturado_periodo numeric; v_cobrado_periodo numeric;
  v_deuda_total numeric; v_admins_morosos int; v_tramites_abiertos int;
  v_vencimientos_proximos int; v_serie jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(SUM(total),0) INTO v_facturado_periodo
    FROM comprobantes WHERE estado='autorizado' AND fecha >= p_desde;

  SELECT COALESCE(SUM(mi.monto_imputado),0) INTO v_cobrado_periodo
    FROM movimiento_imputaciones mi JOIN movimientos m ON m.id=mi.movimiento_id
   WHERE m.fecha >= p_desde AND m.tipo='ingreso' AND m.estado <> 'anulado';

  -- Deuda NETA de la cartera + morosos NETOS (deuda bruta − crédito por admin).
  WITH deudas AS (
    SELECT administracion_id AS aid, SUM(saldo_pendiente) AS deuda
    FROM comprobantes WHERE saldo_pendiente>0 AND estado='autorizado'
    GROUP BY administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado,0)) AS credito
    FROM movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM movimiento_imputaciones mi
       WHERE mi.movimiento_id=m.id AND mi.comprobante_id IS NOT NULL) imp ON true
    WHERE m.administracion_id IS NOT NULL AND m.tipo='ingreso'
      AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado,0)) > 0.001
    GROUP BY m.administracion_id
  ),
  neto AS (
    SELECT d.aid, (d.deuda - COALESCE(cr.credito,0)) AS deuda_neta
    FROM deudas d LEFT JOIN creditos cr ON cr.aid=d.aid
  )
  SELECT COALESCE(SUM(deuda_neta) FILTER (WHERE deuda_neta>0),0),
         COUNT(*) FILTER (WHERE deuda_neta>0)
    INTO v_deuda_total, v_admins_morosos
    FROM neto;

  SELECT COUNT(*) INTO v_tramites_abiertos
    FROM tramites WHERE estado IN ('abierto','en_progreso','esperando_cliente');

  SELECT COUNT(*) INTO v_vencimientos_proximos
    FROM vencimientos WHERE estado='vigente'
     AND fecha_vencimiento >= current_date AND fecha_vencimiento <= current_date + interval '30 days';

  SELECT jsonb_agg(jsonb_build_object('fecha',d,'facturado',COALESCE(daily,0)) ORDER BY d)
    INTO v_serie
    FROM (SELECT gs::date AS d,
            (SELECT COALESCE(SUM(total),0) FROM comprobantes WHERE estado='autorizado' AND fecha=gs::date) AS daily
          FROM generate_series(p_desde, current_date, interval '1 day') gs) src;

  v_result := jsonb_build_object(
    'facturado_periodo', v_facturado_periodo, 'cobrado_periodo', v_cobrado_periodo,
    'deuda_total', v_deuda_total, 'admins_morosos', v_admins_morosos,
    'tramites_abiertos', v_tramites_abiertos, 'vencimientos_proximos', v_vencimientos_proximos,
    'serie_facturado', COALESCE(v_serie,'[]'::jsonb));
  RETURN v_result;
END;
$function$;
