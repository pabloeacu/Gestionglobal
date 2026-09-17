-- 0498 · Auditoría 2026-09 · DGG-186: correctitud de mora — 2 fixes de backend (CREATE OR REPLACE,
-- sin DROP → grants intactos; verificados e2e con rollback antes de commitear).
--
-- Contexto: auditoría multi-agente + reconciliación (DGG-186). HOY la mora reconcilia 100%
-- (saldo_pendiente == total - imputado del libro en los 127 comprobantes) y las 3 superficies
-- cuadran ($3.010.000 / 17). Estos 2 fixes cierran huecos LATENTES para que SIGA siendo correcta.
--
-- FIX 3 (E-GG-211) · saldo_pendiente stale al editar ítems de un comprobante ya cobrado:
--   recalcular_totales_comprobante() (trigger AFTER I/U/D en items_comprobantes) recalculaba el
--   saldo SOLO cuando estado_cobranza='pendiente' (CASE WHEN 'pendiente' THEN total ELSE saldo).
--   Si se editaban los ítems (cambia `total`) de un comprobante 'parcial'/'pagado'/'vencido', el
--   saldo quedaba VIEJO (mora mal informada) hasta el próximo evento de imputación. Fix: recalcular
--   SIEMPRE con la fórmula canónica saldo = GREATEST(0, total - imputado_del_libro) — idéntica a
--   recalcular_saldo_comprobante_imputado() (SSOT del saldo). NO se toca estado_cobranza (igual que
--   antes; las RPC de mora derivan 'vencido' de la fecha, no de la etiqueta). Hoy 0 filas en drift.
--
-- FIX 2 · cuenta_corriente_morosos (widget "Top deudores" del Inicio) mezclaba deuda vencida y
--   NO vencida: sumaba TODO comprobante con saldo>0 sin exigir vencimiento pasado, por lo que una
--   administración con deuda sólo por-vencer podía figurar en "Morosos". Fix: exigir al menos 1
--   comprobante VENCIDO (n.venc > 0) para listar. Los contadores pendientes/vencidos y el monto
--   (deuda neta) se mantienen. NO afecta el KPI "Deuda total" del home (usa kpis_dashboard_global,
--   que por diseño es deuda total = vencida + por-vencer). Hoy 0 cambio (las 17 con saldo están
--   todas vencidas).

-- ── FIX 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalcular_totales_comprobante()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_imputado numeric;
BEGIN
  v_id := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
  -- imputado real del libro (misma fuente que el trigger de imputaciones)
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado
    FROM public.movimiento_imputaciones WHERE comprobante_id = v_id;

  UPDATE public.comprobantes c SET
    neto       = sub.neto,
    exento     = sub.exento,
    no_gravado = sub.no_gravado,
    iva_21     = sub.iva_21,
    iva_105    = sub.iva_105,
    iva_27     = sub.iva_27,
    total_iva  = sub.total_iva,
    total      = sub.total,
    -- E-GG-211: recalcular SIEMPRE (antes solo si 'pendiente' → saldo stale al editar ítems de un
    -- comprobante ya cobrado). Fórmula canónica = la de recalcular_saldo_comprobante_imputado (SSOT).
    saldo_pendiente = GREATEST(0, sub.total - v_imputado)
  FROM (
    SELECT
      COALESCE(SUM(CASE WHEN alicuota_iva IN ('21','10.5','27','0') THEN subtotal ELSE 0 END), 0) AS neto,
      COALESCE(SUM(CASE WHEN alicuota_iva = 'exento'     THEN subtotal ELSE 0 END), 0) AS exento,
      COALESCE(SUM(CASE WHEN alicuota_iva = 'no_gravado' THEN subtotal ELSE 0 END), 0) AS no_gravado,
      COALESCE(SUM(CASE WHEN alicuota_iva = '21'   THEN iva ELSE 0 END), 0) AS iva_21,
      COALESCE(SUM(CASE WHEN alicuota_iva = '10.5' THEN iva ELSE 0 END), 0) AS iva_105,
      COALESCE(SUM(CASE WHEN alicuota_iva = '27'   THEN iva ELSE 0 END), 0) AS iva_27,
      COALESCE(SUM(iva), 0)   AS total_iva,
      COALESCE(SUM(total), 0) AS total
    FROM public.items_comprobantes WHERE comprobante_id = v_id
  ) sub
  WHERE c.id = v_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ── FIX 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_corriente_morosos(p_limit integer DEFAULT 10)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, deuda_total numeric, comprobantes_vencidos integer, comprobantes_pendientes integer, mayor_dias_vencido integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff puede consultar morosos'; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT a.id, a.nombre,
      COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta,
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
  -- FIX 2: sólo morosos reales (al menos 1 comprobante VENCIDO); antes listaba deuda por-vencer también.
  WHERE n.deuda_neta > 0 AND n.venc > 0
  ORDER BY n.deuda_neta DESC
  LIMIT GREATEST(p_limit,1);
END;
$function$;
