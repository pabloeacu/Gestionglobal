-- 0353 · wave 7 · E-GG-136
-- "Vencido" nunca se deriva de estado_cobranza (nadie envejece la columna a
-- 'vencido' → toma sólo 'pendiente'/'parcial'/'pagado'). Todos los contadores
-- de morosos/vencidos que filtraban `estado_cobranza = 'vencido'` daban SIEMPRE
-- 0, incluso con comprobantes realmente vencidos. Se deriva por FECHA
-- (vencimiento < current_date, saldo > 0, comprobante vivo) igual que ya hacían
-- `comprobantes_morosos` (motor de recupero) y `cliente_deuda_neta` (portal home).
--
-- Superficies afectadas (todas SOLO lectura/KPI; el motor de cobranza automática
-- NO dependía de esto y estaba OK):
--   · cuenta_corriente_morosos         (venc + maxdias)   → CtaCte gerencia
--   · cuenta_corriente_resumen         (vencidos)          → ficha administración
--   · cuenta_corriente_resumen_global  (vencidos)          → lista CtaCte gerencia
--   + front: ComprobantesListPage / PortalComprobantesPage (KPI/badge/filtro).
--
-- CREATE OR REPLACE: firmas idénticas → no cambia aridad (R16 no exige DROP) y
-- se preservan los GRANTs existentes.

-- ── 1 · cuenta_corriente_morosos ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_corriente_morosos(p_limit integer DEFAULT 10)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, deuda_total numeric, comprobantes_vencidos integer, comprobantes_pendientes integer, mayor_dias_vencido integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff puede consultar morosos'; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT a.id, a.nombre,
      COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta,
      -- E-GG-136: vencido por fecha, no por estado_cobranza (que nunca es 'vencido').
      COUNT(*) FILTER (WHERE c.vencimiento IS NOT NULL AND c.vencimiento < current_date)::int AS venc,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pend,
      COALESCE(MAX(CASE WHEN c.vencimiento IS NOT NULL AND c.vencimiento < current_date
                        THEN (current_date - c.vencimiento)::int ELSE 0 END),0)::int AS maxdias
    FROM public.administraciones a
    JOIN public.comprobantes c ON c.administracion_id=a.id
    WHERE c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente>0
    GROUP BY a.id, a.nombre
  ),
  neto AS (
    SELECT d.*, (d.deuda_bruta - public.administracion_credito_disponible(d.id)) AS deuda_neta
    FROM deudas d
  )
  SELECT n.id, n.nombre, n.deuda_neta::numeric, n.venc, n.pend, n.maxdias
  FROM neto n
  WHERE n.deuda_neta > 0
  ORDER BY n.deuda_neta DESC
  LIMIT GREATEST(p_limit,1);
END;
$function$;

-- ── 2 · cuenta_corriente_resumen ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen(p_administracion_id uuid, p_desde date DEFAULT ((CURRENT_DATE - '1 year'::interval))::date, p_hasta date DEFAULT CURRENT_DATE)
 RETURNS TABLE(saldo_inicial numeric, total_facturado numeric, total_cobrado numeric, saldo_actual numeric, comprobantes_pendientes integer, comprobantes_vencidos integer, deuda_total numeric, saldo_a_favor numeric, proximo_vencimiento date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  RETURN QUERY
  WITH
  cargos_prev AS (
    SELECT COALESCE(SUM(total), 0) AS x FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha < p_desde
  ),
  abonos_prev AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha < p_desde AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  credito_prev AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha < p_desde AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  cargos_rango AS (
    SELECT COALESCE(SUM(total), 0) AS x FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha BETWEEN p_desde AND p_hasta
  ),
  abonos_rango AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  credito_rango AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  credito_actual AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  saldos_actuales AS (
    SELECT
      COALESCE(SUM(saldo_pendiente), 0) AS deuda_total,
      COUNT(*) FILTER (WHERE estado_cobranza IN ('pendiente','parcial'))::int AS pendientes,
      -- E-GG-136: vencido derivado por fecha (estado_cobranza nunca es 'vencido').
      COUNT(*) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial')
          AND vencimiento IS NOT NULL AND vencimiento < current_date
      )::int AS vencidos,
      MIN(vencimiento) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial') AND vencimiento >= current_date
      ) AS proximo
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id AND estado NOT IN ('anulado','borrador')
  )
  SELECT
    (cargos_prev.x - abonos_prev.x - credito_prev.x)         AS saldo_inicial,
    cargos_rango.x                                           AS total_facturado,
    abonos_rango.x                                           AS total_cobrado,
    (cargos_prev.x - abonos_prev.x - credito_prev.x
      + cargos_rango.x - abonos_rango.x - credito_rango.x)   AS saldo_actual,
    saldos_actuales.pendientes,
    saldos_actuales.vencidos,
    saldos_actuales.deuda_total,
    credito_actual.x                                         AS saldo_a_favor,
    saldos_actuales.proximo
  FROM cargos_prev, abonos_prev, credito_prev, cargos_rango, abonos_rango,
       credito_rango, credito_actual, saldos_actuales;
END;
$function$;

-- ── 3 · cuenta_corriente_resumen_global ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen_global(p_desde date DEFAULT ((CURRENT_DATE - '1 year'::interval))::date, p_hasta date DEFAULT CURRENT_DATE)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, total_facturado numeric, total_cobrado numeric, deuda_total numeric, saldo_a_favor numeric, comprobantes_vencidos integer, comprobantes_pendientes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar el resumen global';
  END IF;

  RETURN QUERY
  WITH cargos AS (
    SELECT c.administracion_id AS aid, SUM(c.total) AS x
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador') AND c.fecha BETWEEN p_desde AND p_hasta
    GROUP BY c.administracion_id
  ),
  abonos AS (
    SELECT c.administracion_id AS aid, SUM(mi.monto_imputado) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
    GROUP BY c.administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado, 0)) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    GROUP BY m.administracion_id
  ),
  deudas AS (
    SELECT c.administracion_id AS aid, SUM(c.saldo_pendiente) AS deuda,
      -- E-GG-136: vencido derivado por fecha (estado_cobranza nunca es 'vencido').
      COUNT(*) FILTER (
        WHERE c.estado_cobranza IN ('pendiente','parcial')
          AND c.vencimiento IS NOT NULL AND c.vencimiento < current_date
      )::int AS vencidos,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pendientes
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador')
    GROUP BY c.administracion_id
  )
  SELECT
    a.id, a.nombre,
    COALESCE(cargos.x, 0)::numeric, COALESCE(abonos.x, 0)::numeric,
    COALESCE(deudas.deuda, 0)::numeric, COALESCE(creditos.x, 0)::numeric,
    COALESCE(deudas.vencidos, 0), COALESCE(deudas.pendientes, 0)
  FROM public.administraciones a
  LEFT JOIN cargos ON cargos.aid = a.id
  LEFT JOIN abonos ON abonos.aid = a.id
  LEFT JOIN creditos ON creditos.aid = a.id
  LEFT JOIN deudas ON deudas.aid = a.id
  WHERE a.activo = true
    AND (COALESCE(cargos.x, 0) > 0 OR COALESCE(abonos.x, 0) > 0
         OR COALESCE(deudas.deuda, 0) > 0 OR COALESCE(creditos.x, 0) > 0)
  ORDER BY COALESCE(deudas.deuda, 0) DESC, a.nombre ASC;
END;
$function$;
