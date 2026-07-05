-- 0277 · E-GG-86 (addendum) · "Cobranza" significa lo mismo en todos lados
-- ============================================================================
-- Pablo (2026-07-04): "Es importante que cobranza signifique lo mismo en todos
-- lados. Es parte de la consistencia contable."
--
-- `analitica_cobranzas_mensual` sumaba INGRESOS BRUTOS (todo movimiento tipo
-- 'ingreso' no revertido), lo que contaba como "cobranza": (a) saldos a favor no
-- aplicados a ninguna deuda, y (b) pagos de comprobantes que después se anularon.
-- El resto del sistema (cta cte `total_cobrado`, reporte) define cobranza como
-- PLATA IMPUTADA A UN COMPROBANTE VIGENTE. Se alinea la analítica a esa misma
-- definición: cuenta `movimiento_imputaciones.monto_imputado` de ingresos vivos
-- imputados a comprobantes no anulados. Misma firma de retorno → CREATE OR REPLACE
-- (sin overload, R16). Baja los totales a la cobranza real (aprobado por Pablo).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.analitica_cobranzas_mensual(p_meses integer DEFAULT 12)
RETURNS TABLE(mes date, total numeric, cantidad integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now()) - (p_meses - 1) * INTERVAL '1 month',
      date_trunc('month', now()),
      INTERVAL '1 month'
    )::date AS mes
  ),
  cobros AS (
    SELECT date_trunc('month', mv.fecha)::date AS mes,
           mi.monto_imputado AS monto,
           mi.id AS imp_id
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos mv ON mv.id = mi.movimiento_id
      AND mv.tipo = 'ingreso'
      AND mv.estado = 'identificado'
      AND mv.revertido_at IS NULL
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
      AND c.estado NOT IN ('anulado','borrador')
  )
  SELECT m.mes,
         COALESCE(SUM(cb.monto), 0)::numeric AS total,
         COALESCE(COUNT(cb.imp_id), 0)::int AS cantidad
  FROM meses m
  LEFT JOIN cobros cb ON cb.mes = m.mes
  WHERE private.is_staff()
  GROUP BY m.mes
  ORDER BY m.mes;
$function$;
