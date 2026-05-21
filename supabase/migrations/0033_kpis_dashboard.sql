-- 0033 — KPIs del dashboard de gerencia (regla 5, 11, 12).
-- Función agregadora pensada para la home de staff. Sólo gerentes/staff
-- pueden ejecutarla (los administradores tienen su propio dashboard).
--
-- Notas (regla 8 / E43): validamos contra el schema real, por eso
--   - movimientos.tipo NO tiene valor 'cobranza' (chk: ingreso/egreso/transferencia_in/out).
--     Las cobranzas son ingresos imputados a comprobantes vía movimiento_imputaciones.
--   - la columna de imputación se llama 'monto_imputado', no 'monto'.
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(
  p_desde date DEFAULT (now() - interval '30 days')::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_facturado_periodo numeric;
  v_cobrado_periodo numeric;
  v_deuda_total numeric;
  v_admins_morosos int;
  v_tramites_abiertos int;
  v_vencimientos_proximos int;
  v_serie jsonb;
BEGIN
  -- Solo staff. Los admin tienen su propio dashboard.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(SUM(total), 0)
    INTO v_facturado_periodo
    FROM comprobantes
   WHERE estado = 'autorizado'
     AND fecha >= p_desde;

  -- Cobrado del período: suma de monto_imputado de imputaciones cuyo
  -- movimiento es un ingreso (cobro) dentro del rango.
  SELECT COALESCE(SUM(mi.monto_imputado), 0)
    INTO v_cobrado_periodo
    FROM movimiento_imputaciones mi
    JOIN movimientos m ON m.id = mi.movimiento_id
   WHERE m.fecha >= p_desde
     AND m.tipo = 'ingreso'
     AND m.estado <> 'anulado';

  SELECT COALESCE(SUM(saldo_pendiente), 0)
    INTO v_deuda_total
    FROM comprobantes
   WHERE saldo_pendiente > 0
     AND estado = 'autorizado';

  SELECT COUNT(DISTINCT administracion_id)
    INTO v_admins_morosos
    FROM comprobantes
   WHERE saldo_pendiente > 0
     AND estado = 'autorizado';

  SELECT COUNT(*)
    INTO v_tramites_abiertos
    FROM tramites
   WHERE estado IN ('abierto', 'en_progreso', 'esperando_cliente');

  SELECT COUNT(*)
    INTO v_vencimientos_proximos
    FROM vencimientos
   WHERE estado = 'vigente'
     AND fecha_vencimiento >= current_date
     AND fecha_vencimiento <= current_date + interval '30 days';

  -- Serie diaria: facturado por fecha desde p_desde hasta hoy.
  SELECT jsonb_agg(
           jsonb_build_object('fecha', d, 'facturado', COALESCE(daily, 0))
           ORDER BY d
         )
    INTO v_serie
    FROM (
      SELECT gs::date AS d,
             (SELECT COALESCE(SUM(total), 0)
                FROM comprobantes
               WHERE estado = 'autorizado'
                 AND fecha = gs::date) AS daily
        FROM generate_series(p_desde, current_date, interval '1 day') gs
    ) src;

  v_result := jsonb_build_object(
    'facturado_periodo',    v_facturado_periodo,
    'cobrado_periodo',      v_cobrado_periodo,
    'deuda_total',          v_deuda_total,
    'admins_morosos',       v_admins_morosos,
    'tramites_abiertos',    v_tramites_abiertos,
    'vencimientos_proximos', v_vencimientos_proximos,
    'serie_facturado',      COALESCE(v_serie, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.kpis_dashboard_global(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpis_dashboard_global(date) TO authenticated;

COMMENT ON FUNCTION public.kpis_dashboard_global(date) IS
  'KPI strip del dashboard de gerencia. Solo staff. Ver doc 0033.';
