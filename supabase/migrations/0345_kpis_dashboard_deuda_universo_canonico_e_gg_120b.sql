-- 0345 · DGG-108 / E-GG-120b: alinear el universo de deuda del Inicio de gerencia
-- al canon. Hallazgo de la revisión adversarial de 0344 (severidad baja, latente).
--
-- `kpis_dashboard_global` (KPI "Deuda total" del Inicio de gerencia) calculaba la deuda
-- sobre `estado='autorizado'`, más angosto que el canon de las 4 superficies de saldo
-- (`estado NOT IN ('anulado','borrador')`, que además incluye procesando/observado/
-- rechazado/compensado/error). El neteo de crédito YA estaba alineado (usa el mismo
-- patrón que `administracion_credito_disponible`). Hoy NO diverge en datos (los 8
-- comprobantes están en 'autorizado'), por eso era latente: en cuanto exista un
-- comprobante con saldo_pendiente>0 en un estado no-autorizado, el Inicio de gerencia
-- sub-contaría la deuda respecto de cta.cte/ficha/portal.
--
-- Cambio quirúrgico: SOLO el filtro `estado` de la CTE `deudas` (de '=autorizado' a
-- 'NOT IN (anulado,borrador)'). Las métricas de PERÍODO (facturado/cobrado/serie)
-- quedan igual: son actividad reciente, no saldo (el `cobrado` con `m.estado<>'anulado'`
-- se deja como follow-up documentado). CREATE OR REPLACE, misma firma (R16 ok).
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(p_desde date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  WITH deudas AS (
    SELECT administracion_id AS aid, SUM(saldo_pendiente) AS deuda
    FROM comprobantes WHERE saldo_pendiente>0 AND estado NOT IN ('anulado','borrador')  -- DGG-108: universo canónico
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
    INTO v_deuda_total, v_admins_morosos FROM neto;
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
