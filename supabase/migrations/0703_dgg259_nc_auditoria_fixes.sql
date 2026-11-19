-- 0703_dgg259_nc_auditoria_fixes.sql
-- =============================================================================
-- DGG-259 · Chunk 1 — Cierre de hallazgos de la doble auditoría §6 (3 agentes).
--
-- 🔴 (1) anular_comprobante dejaba HUÉRFANA una NC viva: anular el original con una
--        NC acreditándolo rompía el invariante (crédito fantasma, medido saldo_actual=-400).
--        → guard: no se anula un comprobante con NC activas (anulá/revertí las NC primero).
-- 🔴 (2) kpis_dashboard_global sumaba la NC como facturación POSITIVA y perdía los
--        'compensado'. → facturado + serie firmados (NC negativa) e incluyen 'compensado'.
-- 🟠 (3) analitica_facturacion_mensual / analitica_top_clientes: firmar NC negativa.
-- 🟠 (4) analitica_mix_servicios: excluir NC (su ítem no es venta de servicio).
-- 🟠 (5) en_recupero: recompute lo pisaba → el comprobante salía del recupero manual y
--        RE-ENTRABA a avisos automáticos (vw_comprobantes_para_avisar excluye en_recupero).
--        9 comprobantes reales en ese estado. → preservar en_recupero mientras haya saldo.
-- 🟠 (6) trg_imp_validar_sum_no_supera_total: NC-aware (tope = total − ΣNC) — defensa en
--        profundidad (los RPC sancionados ya capan por saldo_pendiente NC-aware).
-- 🟡 (7) partner_sabana: la columna display 'comprobante_saldo'/chip restaba sólo cobranzas,
--        no NC → saldo mostrado sobre-estimado. La plata del partner (cobranzas) NO cambia.
-- 🟡 (8) tramite_cobro_resumen: 'pagado_anulable' = total − saldo contaba el crédito de la NC
--        como "pagado". → basar en cobranzas reales (imputaciones). Idéntico sin NC.
--
-- Todos idénticos para el universo actual (235 X, 0 NC). R16: todas CREATE OR REPLACE
-- misma firma. R17: SECURITY DEFINER donde corresponde.
-- =============================================================================

-- (1+5) recompute: preserva 'en_recupero' mientras el comprobante tenga saldo.
CREATE OR REPLACE FUNCTION private.recompute_comprobante_saldo(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_tipo text; v_total numeric; v_estado text; v_venc date; v_ref uuid; v_cur_cob text;
  v_imputado numeric; v_nc numeric; v_saldo numeric; v_estado_cob text; v_new_estado text;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT tipo, total, estado, vencimiento, comprobante_referencia_id, estado_cobranza
    INTO v_tipo, v_total, v_estado, v_venc, v_ref, v_cur_cob
    FROM public.comprobantes WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_tipo LIKE 'NC\_%' THEN
    UPDATE public.comprobantes
       SET saldo_pendiente = 0,
           estado_cobranza = CASE WHEN v_estado = 'anulado' THEN 'anulado' ELSE 'pagado' END
     WHERE id = p_id
       AND (saldo_pendiente IS DISTINCT FROM 0
            OR estado_cobranza IS DISTINCT FROM (CASE WHEN v_estado = 'anulado' THEN 'anulado' ELSE 'pagado' END));
    IF v_ref IS NOT NULL THEN
      PERFORM private.recompute_comprobante_saldo(v_ref);
    END IF;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado
    FROM public.movimiento_imputaciones WHERE comprobante_id = p_id;

  SELECT COALESCE(SUM(total), 0) INTO v_nc
    FROM public.comprobantes
   WHERE comprobante_referencia_id = p_id
     AND tipo LIKE 'NC\_%'
     AND estado NOT IN ('anulado', 'borrador');

  v_saldo := GREATEST(0, round(v_total - v_imputado - v_nc, 2));

  v_estado_cob := CASE
    WHEN v_estado = 'anulado'                         THEN 'anulado'
    WHEN v_saldo <= 0                                 THEN 'pagado'
    WHEN v_imputado > 0                               THEN 'parcial'
    WHEN v_venc IS NOT NULL AND v_venc < v_today      THEN 'vencido'
    ELSE 'pendiente'
  END;

  -- Preservar recupero manual: no sacar de 'en_recupero' mientras haya deuda (si no, re-entra a avisos).
  IF v_cur_cob = 'en_recupero' AND v_estado <> 'anulado' AND v_saldo > 0 THEN
    v_estado_cob := 'en_recupero';
  END IF;

  IF v_estado IN ('autorizado', 'compensado') THEN
    v_new_estado := CASE
      WHEN v_nc > 0 AND round(v_imputado + v_nc, 2) >= v_total THEN 'compensado'
      ELSE 'autorizado'
    END;
  ELSE
    v_new_estado := v_estado;
  END IF;

  UPDATE public.comprobantes
     SET saldo_pendiente = v_saldo, estado_cobranza = v_estado_cob, estado = v_new_estado
   WHERE id = p_id
     AND (saldo_pendiente IS DISTINCT FROM v_saldo
          OR estado_cobranza IS DISTINCT FROM v_estado_cob
          OR estado IS DISTINCT FROM v_new_estado);
END;
$fn$;

-- (1) anular_comprobante: guard anti-NC-huérfana.
CREATE OR REPLACE FUNCTION public.anular_comprobante(p_comprobante_id uuid, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_comp public.comprobantes%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia/operación puede anular comprobantes'; END IF;
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante no encontrado'; END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'El comprobante ya está anulado'; END IF;
  IF v_comp.cae IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede anular un comprobante con CAE (%). Emití una nota de crédito.', v_comp.cae;
  END IF;

  -- DGG-259: no anular un comprobante positivo que tiene notas de crédito vivas (quedarían
  -- huérfanas acreditando un comprobante anulado = crédito fantasma / invariante roto).
  IF v_comp.tipo IN ('A','B','C','X') AND EXISTS (
       SELECT 1 FROM public.comprobantes nc
        WHERE nc.comprobante_referencia_id = p_comprobante_id
          AND nc.tipo LIKE 'NC\_%'
          AND nc.estado NOT IN ('anulado','borrador')
     ) THEN
    RAISE EXCEPTION 'El comprobante tiene notas de crédito asociadas. Anulá o revertí las notas de crédito antes de anular el comprobante.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.movimiento_imputaciones WHERE comprobante_id = p_comprobante_id;

  UPDATE public.comprobantes SET
    estado='anulado', estado_cobranza='anulado', saldo_pendiente=0,
    motivo_rechazo = COALESCE(NULLIF(trim(p_motivo), ''), 'Anulación manual')
  WHERE id = p_comprobante_id;

  UPDATE public.arca_emision_queue SET status='cancelled', updated_at=now()
   WHERE comprobante_id = p_comprobante_id AND status IN ('pending','sending');

  UPDATE public.email_queue SET status='cancelled', ultimo_error='Comprobante anulado'
   WHERE status IN ('pending','scheduled')
     AND id IN (SELECT email_queue_id FROM public.recupero_acciones
                 WHERE comprobante_id = p_comprobante_id AND email_queue_id IS NOT NULL);

  RETURN p_comprobante_id;
END;
$fn$;

-- (6) validador de imputación NC-aware.
CREATE OR REPLACE FUNCTION public.trg_imp_validar_sum_no_supera_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sum_otros numeric;
  v_total     numeric;
  v_nc        numeric;
BEGIN
  IF NEW.comprobante_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT total INTO v_total FROM public.comprobantes WHERE id = NEW.comprobante_id;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'comprobante_inexistente_para_imputacion' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO v_nc
    FROM public.comprobantes
   WHERE comprobante_referencia_id = NEW.comprobante_id
     AND tipo LIKE 'NC\_%' AND estado NOT IN ('anulado','borrador');

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_sum_otros
    FROM public.movimiento_imputaciones
   WHERE comprobante_id = NEW.comprobante_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_sum_otros + NEW.monto_imputado) > (v_total - v_nc) + 0.001 THEN
    RAISE EXCEPTION
      'La suma de pagos imputados (%) supera el saldo acreditable del comprobante (%)',
      v_sum_otros + NEW.monto_imputado, (v_total - v_nc)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

-- (2) kpis_dashboard_global: facturado + serie firmados + incluyen 'compensado'.
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(p_desde date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_result jsonb; v_facturado_periodo numeric; v_cobrado_periodo numeric;
  v_deuda_total numeric; v_admins_morosos int; v_tramites_abiertos int;
  v_vencimientos_proximos int; v_serie jsonb;
  v_pasivo_total numeric; v_egreso_devengado_periodo numeric; v_egreso_pagado_periodo numeric;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(SUM(CASE WHEN tipo LIKE 'NC\_%' THEN -total ELSE total END),0) INTO v_facturado_periodo
    FROM comprobantes WHERE estado IN ('autorizado','compensado') AND fecha >= p_desde;
  SELECT COALESCE(SUM(mi.monto_imputado),0) INTO v_cobrado_periodo
    FROM movimiento_imputaciones mi JOIN movimientos m ON m.id=mi.movimiento_id
   WHERE m.fecha >= p_desde AND m.tipo='ingreso' AND m.estado <> 'anulado';
  WITH deudas AS (
    SELECT administracion_id AS aid, SUM(saldo_pendiente) AS deuda
    FROM comprobantes WHERE saldo_pendiente>0 AND estado NOT IN ('anulado','borrador')
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
     AND COALESCE(origen,'') <> 'declarado'
     AND fecha_vencimiento >= current_date AND fecha_vencimiento <= current_date + interval '30 days';

  SELECT COALESCE(SUM(saldo_pendiente),0) INTO v_pasivo_total
    FROM egresos WHERE estado='activo' AND saldo_pendiente > 0;
  SELECT COALESCE(SUM(total),0) INTO v_egreso_devengado_periodo
    FROM egresos WHERE estado='activo' AND fecha >= p_desde;
  SELECT COALESCE(SUM(monto),0) INTO v_egreso_pagado_periodo
    FROM movimientos WHERE tipo='egreso' AND estado <> 'anulado' AND revertido_at IS NULL AND fecha >= p_desde;

  SELECT jsonb_agg(jsonb_build_object('fecha',d,'facturado',COALESCE(daily,0)) ORDER BY d)
    INTO v_serie
    FROM (SELECT gs::date AS d,
            (SELECT COALESCE(SUM(CASE WHEN tipo LIKE 'NC\_%' THEN -total ELSE total END),0)
               FROM comprobantes WHERE estado IN ('autorizado','compensado') AND fecha=gs::date) AS daily
          FROM generate_series(p_desde, current_date, interval '1 day') gs) src;
  v_result := jsonb_build_object(
    'facturado_periodo', v_facturado_periodo, 'cobrado_periodo', v_cobrado_periodo,
    'deuda_total', v_deuda_total, 'admins_morosos', v_admins_morosos,
    'tramites_abiertos', v_tramites_abiertos, 'vencimientos_proximos', v_vencimientos_proximos,
    'pasivo_total', v_pasivo_total,
    'egreso_devengado_periodo', v_egreso_devengado_periodo,
    'egreso_pagado_periodo', v_egreso_pagado_periodo,
    'serie_facturado', COALESCE(v_serie,'[]'::jsonb));
  RETURN v_result;
END;
$fn$;

-- (3) analitica_facturacion_mensual: firmar NC negativa.
CREATE OR REPLACE FUNCTION public.analitica_facturacion_mensual(p_meses integer DEFAULT 12)
 RETURNS TABLE(mes date, total numeric, cantidad integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now(), 'America/Argentina/Buenos_Aires') - (p_meses - 1) * INTERVAL '1 month',
      date_trunc('month', now(), 'America/Argentina/Buenos_Aires'),
      INTERVAL '1 month'
    )::date AS mes
  )
  SELECT m.mes,
         COALESCE(SUM(CASE WHEN c.tipo LIKE 'NC\_%' THEN -c.total ELSE c.total END), 0)::numeric AS total,
         COALESCE(COUNT(c.id) FILTER (WHERE c.id IS NOT NULL AND c.tipo NOT LIKE 'NC\_%'), 0)::int AS cantidad
  FROM meses m
  LEFT JOIN public.comprobantes c
    ON date_trunc('month', c.fecha) = m.mes
    AND c.estado NOT IN ('anulado', 'borrador')
    AND (private.is_staff() OR c.administracion_id = private.current_administracion_id())
  GROUP BY m.mes
  ORDER BY m.mes;
$fn$;

-- (3) analitica_top_clientes: firmar NC negativa.
CREATE OR REPLACE FUNCTION public.analitica_top_clientes(p_dias integer DEFAULT 90, p_limit integer DEFAULT 10)
 RETURNS TABLE(administracion_id uuid, nombre text, total_facturado numeric, total_comprobantes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT c.administracion_id,
         COALESCE(a.nombre, '(sin admin)') AS nombre,
         COALESCE(SUM(CASE WHEN c.tipo LIKE 'NC\_%' THEN -c.total ELSE c.total END), 0)::numeric AS total_facturado,
         COUNT(c.id) FILTER (WHERE c.tipo NOT LIKE 'NC\_%')::int AS total_comprobantes
  FROM public.comprobantes c
  LEFT JOIN public.administraciones a ON a.id = c.administracion_id
  WHERE private.is_staff()
    AND c.fecha >= (public.hoy_ar() - p_dias)
    AND c.estado NOT IN ('anulado', 'borrador')
  GROUP BY c.administracion_id, a.nombre
  ORDER BY total_facturado DESC
  LIMIT LEAST(p_limit, 50);
$fn$;

-- (4) analitica_mix_servicios: excluir NC.
CREATE OR REPLACE FUNCTION public.analitica_mix_servicios(p_dias integer DEFAULT 90)
 RETURNS TABLE(servicio_id uuid, nombre text, total numeric, cantidad integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ic.servicio_id,
         COALESCE(s.nombre, ic.descripcion, '(sin servicio)') AS nombre,
         COALESCE(SUM(ic.subtotal), 0)::numeric AS total,
         COUNT(ic.id)::int AS cantidad
  FROM public.items_comprobantes ic
  JOIN public.comprobantes c ON c.id = ic.comprobante_id
  LEFT JOIN public.servicios s ON s.id = ic.servicio_id
  WHERE private.is_staff()
    AND c.fecha >= (public.hoy_ar() - p_dias)
    AND c.estado NOT IN ('anulado', 'borrador')
    AND c.tipo NOT LIKE 'NC\_%'
  GROUP BY ic.servicio_id, s.nombre, ic.descripcion
  ORDER BY total DESC
  LIMIT 12;
$fn$;

-- (8) tramite_cobro_resumen: 'pagado_anulable' sobre cobranzas reales (no total − saldo).
CREATE OR REPLACE FUNCTION public.tramite_cobro_resumen(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  WITH comps AS (
    SELECT c.id, c.cae, c.total, c.saldo_pendiente,
           COALESCE((SELECT SUM(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                      WHERE mi.comprobante_id = c.id), 0) AS cobrado
      FROM public.comprobantes c
      JOIN public.tramites t ON t.id = p_tramite_id
     WHERE c.estado <> 'anulado'
       AND ( c.id = t.comprobante_id
             OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                          WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL) )
  )
  SELECT jsonb_build_object(
    'tiene_comprobante', EXISTS(SELECT 1 FROM comps),
    'tiene_anulable',    EXISTS(SELECT 1 FROM comps WHERE cae IS NULL),
    'tiene_cae',         EXISTS(SELECT 1 FROM comps WHERE cae IS NOT NULL),
    'pagado_anulable',   COALESCE((SELECT sum(cobrado) FROM comps WHERE cae IS NULL), 0),
    'saldo_pendiente',   COALESCE((SELECT sum(saldo_pendiente) FROM comps), 0)
  ) INTO v_out;
  RETURN v_out;
END;
$fn$;

-- (7) partner_sabana: saldo display NC-aware (la plata del partner = cobranzas, no cambia).
CREATE OR REPLACE FUNCTION public.partner_sabana(p_partner_id uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, comprobante_id uuid, comprobante_label text, cliente_nombre text, comprobante_total numeric, comprobante_saldo numeric, operacion_monto numeric, chip text, porcentaje numeric, participacion_monto numeric, saldo_participacion numeric, movimiento_id uuid, adjuntos_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_partner uuid; v_caller_partner uuid := private.current_partner_id();
BEGIN
  IF v_caller_partner IS NOT NULL THEN v_partner := v_caller_partner;
  ELSIF private.is_staff() THEN v_partner := p_partner_id;
  ELSE RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF v_partner IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH imp AS (
    SELECT m.fecha AS f, mi.created_at AS ord, mi.monto_imputado AS oper,
      c.id AS comp_id, c.tipo AS ctipo, c.punto_venta AS cpv, c.numero AS cnum,
      c.total AS ctotal, c.administracion_id AS adm_id, m.descripcion AS mdesc, m.id AS mov_id,
      (c.total - COALESCE((SELECT SUM(ncc.total) FROM public.comprobantes ncc
                            WHERE ncc.comprobante_referencia_id = c.id AND ncc.tipo LIKE 'NC\_%'
                              AND ncc.estado NOT IN ('anulado','borrador')), 0))
        - SUM(mi.monto_imputado) OVER (
        PARTITION BY c.id ORDER BY m.fecha, mi.created_at, mi.id ROWS UNBOUNDED PRECEDING) AS saldo_after,
      m.partner_id_atribucion AS pid
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id AND m.tipo = 'ingreso' AND m.estado <> 'anulado'
    JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
    WHERE c.id IN (
      SELECT mi2.comprobante_id FROM public.movimiento_imputaciones mi2
        JOIN public.movimientos m2 ON m2.id = mi2.movimiento_id
       WHERE m2.partner_id_atribucion = v_partner AND m2.tipo='ingreso' AND m2.estado<>'anulado')
  ),
  ingresos AS (
    SELECT i.f AS fecha, 'ingreso'::text AS tipo,
      COALESCE(NULLIF(i.mdesc,''), 'Cobranza') AS descripcion, i.comp_id AS comprobante_id,
      (i.ctipo || ' ' || lpad(i.cpv::text,5,'0') || '-' || lpad(COALESCE(i.cnum,0)::text,8,'0')) AS comprobante_label,
      a.nombre AS cliente_nombre, i.ctotal AS comprobante_total,
      GREATEST(i.saldo_after, 0) AS comprobante_saldo, i.oper AS operacion_monto,
      CASE WHEN i.saldo_after <= 0.009 THEN 'total' ELSE 'parcial' END AS chip,
      i.oper AS base, 'ingreso'::text AS conv_tipo, i.f AS conv_fecha, i.mov_id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = i.mov_id) AS adjuntos_count
    FROM imp i LEFT JOIN public.administraciones a ON a.id = i.adm_id
    WHERE i.pid = v_partner
  ),
  egresos_cash AS (
    SELECT m.fecha AS fecha, 'egreso'::text AS tipo,
      COALESCE(NULLIF(m.descripcion,''), 'Egreso') AS descripcion,
      NULL::uuid AS comprobante_id, NULL::text AS comprobante_label,
      a.nombre AS cliente_nombre, NULL::numeric AS comprobante_total, NULL::numeric AS comprobante_saldo,
      m.monto AS operacion_monto, 'total'::text AS chip,
      m.monto AS base, 'costo'::text AS conv_tipo, m.fecha AS conv_fecha, m.id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = m.id) AS adjuntos_count
    FROM public.movimientos m LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE m.tipo = 'egreso' AND m.estado <> 'anulado' AND m.partner_id_atribucion = v_partner
      AND NOT EXISTS (SELECT 1 FROM public.egreso_pagos ep WHERE ep.movimiento_id = m.id)
  ),
  egresos_oblig AS (
    SELECT eg.fecha AS fecha, 'egreso'::text AS tipo,
      (eg.proveedor_nombre || ' · ' || eg.concepto) AS descripcion,
      NULL::uuid AS comprobante_id, 'Obligación de pago'::text AS comprobante_label,
      COALESCE(a.nombre, eg.proveedor_nombre) AS cliente_nombre,
      eg.total AS comprobante_total, eg.saldo_pendiente AS comprobante_saldo,
      eg.total AS operacion_monto,
      CASE WHEN eg.estado_pago='pagado' THEN 'pagado'
           WHEN eg.estado_pago='parcial' THEN 'parcial'
           ELSE 'impago' END AS chip,
      eg.total AS base, 'costo'::text AS conv_tipo, eg.fecha AS conv_fecha, NULL::uuid AS movimiento_id,
      0::bigint AS adjuntos_count
    FROM public.egresos eg LEFT JOIN public.administraciones a ON a.id = eg.administracion_id
    WHERE eg.estado = 'activo' AND eg.partner_id_atribucion = v_partner
  ),
  todos AS (SELECT * FROM ingresos UNION ALL SELECT * FROM egresos_cash UNION ALL SELECT * FROM egresos_oblig),
  conpart AS (
    SELECT t.*, conv.porc,
      ROUND(t.base * COALESCE(conv.porc,0) / 100.0, 2) AS part_abs,
      CASE WHEN t.conv_tipo = 'ingreso' THEN 1 ELSE -1 END AS signo
    FROM todos t
    LEFT JOIN LATERAL (
      SELECT CASE WHEN t.conv_tipo='ingreso' THEN pc.porc_ingresos ELSE pc.porc_costos END AS porc
        FROM public.partner_convenios pc
       WHERE pc.partner_id = v_partner AND pc.vigencia_desde <= t.conv_fecha
         AND (pc.vigencia_hasta IS NULL OR pc.vigencia_hasta >= t.conv_fecha)
       ORDER BY pc.vigencia_desde DESC LIMIT 1) conv ON true
  ),
  corrido AS (
    SELECT cp.*,
      SUM(cp.part_abs * cp.signo) OVER (
        ORDER BY cp.fecha, cp.conv_tipo DESC, cp.comprobante_id NULLS LAST ROWS UNBOUNDED PRECEDING) AS saldo_part
    FROM conpart cp
  )
  SELECT co.fecha, co.tipo, co.descripcion, co.comprobante_id, co.comprobante_label,
    co.cliente_nombre, co.comprobante_total, co.comprobante_saldo, co.operacion_monto,
    co.chip, COALESCE(co.porc,0)::numeric, co.part_abs, co.saldo_part, co.movimiento_id, co.adjuntos_count
  FROM corrido co
  WHERE (p_desde IS NULL OR co.fecha >= p_desde) AND (p_hasta IS NULL OR co.fecha <= p_hasta)
  ORDER BY co.fecha, co.conv_tipo DESC, co.comprobante_id NULLS LAST;
END;
$fn$;
