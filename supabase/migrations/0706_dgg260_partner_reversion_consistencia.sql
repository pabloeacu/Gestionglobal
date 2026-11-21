-- 0706_dgg260_partner_reversion_consistencia.sql
-- DGG-260 · E-GG-291 — La reversión de un movimiento debe repercutir en TODAS las
-- puntas, también en el Partner.
--
-- Caso: un egreso a docente (Cingolani 23/10, fecha mal en el detalle) se revirtió en
-- la Caja con `fz_revertir_movimiento` (setea `revertido_at` + contra-asiento
-- `origen='reversion'`, `partner_id_atribucion=NULL`). La Caja quedó bien (contra-asiento),
-- pero la **sábana del partner** seguía mostrando la participación -$25.000 del costo
-- revertido, porque deriva la participación EN VIVO desde `movimientos` y su CTE
-- `egresos_cash` filtraba sólo `estado<>'anulado'`, NO `revertido_at`. (El egreso
-- revertido queda en `estado='identificado'` + `revertido_at` seteado.)
--
-- Las cobranzas (ingresos) revertidas YA caían solas porque `fz_revertir` borra sus
-- `movimiento_imputaciones` y la sábana lee ingresos por imputación; el hueco era sólo
-- en egresos-cash (que leen `movimientos` directo).
--
-- Fix (fuente única = `movimientos.revertido_at`; feedback_consistencia_contable):
-- todo lector/productor que derive participación de partner desde `movimientos` excluye
--   `revertido_at IS NULL AND movimiento_revertido_id IS NULL`
-- (lo 1º saca el original revertido; lo 2º saca el contra-asiento). Se fija el LECTOR
-- (`partner_sabana`, que alimenta la sábana + las tarjetas del header) y el PRODUCTOR
-- (`partner_crear_rendicion`, que snapshotea atribuciones), para que una rendición futura
-- tampoco congele un egreso revertido. Sin mutación de datos: no hay atribuciones
-- persistidas (0 rendiciones) y la línea revertida cae sola de la derivación en vivo.
-- CREATE OR REPLACE con la MISMA firma → sin overload ambiguo (R16 OK).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) LECTOR · partner_sabana
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_sabana(p_partner_id uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, comprobante_id uuid, comprobante_label text, cliente_nombre text, comprobante_total numeric, comprobante_saldo numeric, operacion_monto numeric, chip text, porcentaje numeric, participacion_monto numeric, saldo_participacion numeric, movimiento_id uuid, adjuntos_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- DGG-260: excluir ingresos revertidos / contra-asientos (defensivo; sus imputaciones ya se borran al revertir)
      AND m.revertido_at IS NULL AND m.movimiento_revertido_id IS NULL
    JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
    WHERE c.id IN (
      SELECT mi2.comprobante_id FROM public.movimiento_imputaciones mi2
        JOIN public.movimientos m2 ON m2.id = mi2.movimiento_id
       WHERE m2.partner_id_atribucion = v_partner AND m2.tipo='ingreso' AND m2.estado<>'anulado'
         AND m2.revertido_at IS NULL AND m2.movimiento_revertido_id IS NULL)  -- DGG-260
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
      -- DGG-260: un egreso revertido (revertido_at) o su contra-asiento NO participa
      AND m.revertido_at IS NULL AND m.movimiento_revertido_id IS NULL
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) PRODUCTOR · partner_crear_rendicion (que una rendición futura no congele un revertido)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(p_partner_id uuid, p_desde date, p_hasta date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rend_id uuid; v_convenio record;
  v_ing_brutos numeric(14,2); v_ing_atrib numeric(14,2);
  v_cos_brutos numeric(14,2); v_cos_atrib numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede crear rendiciones de partner' USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo inválido (desde=%, hasta=%)', p_desde, p_hasta USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_convenio FROM public.partner_convenios
   WHERE partner_id = p_partner_id AND activo
     AND vigencia_desde <= p_hasta AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_desde)
   ORDER BY vigencia_desde DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay convenio activo del partner % en el periodo % – %', p_partner_id, p_desde, p_hasta
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.partner_rendiciones (partner_id, periodo_desde, periodo_hasta, estado, created_by)
  VALUES (p_partner_id, p_desde, p_hasta, 'borrador', auth.uid())
  RETURNING id INTO v_rend_id;

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id, comprobante_id, movimiento_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido, created_by)
  SELECT p_partner_id, v_convenio.id, v_rend_id, mi.comprobante_id, NULL, mi.id,
    'ingreso', v_convenio.porc_ingresos, mi.monto_imputado,
    ROUND(mi.monto_imputado * v_convenio.porc_ingresos / 100, 2), auth.uid()
  FROM public.movimiento_imputaciones mi
  JOIN public.movimientos m ON m.id = mi.movimiento_id
   AND m.tipo = 'ingreso' AND m.estado <> 'anulado' AND m.partner_id_atribucion = p_partner_id
   -- DGG-260: no snapshotear ingresos revertidos / contra-asientos
   AND m.revertido_at IS NULL AND m.movimiento_revertido_id IS NULL
  JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
  WHERE m.fecha BETWEEN p_desde AND p_hasta
    AND NOT EXISTS (SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.imputacion_id = mi.id AND pa.rendicion_id <> v_rend_id);

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id, comprobante_id, movimiento_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido, created_by)
  SELECT p_partner_id, v_convenio.id, v_rend_id, NULL, m.id, NULL,
    'costo', v_convenio.porc_costos, m.monto,
    ROUND(m.monto * v_convenio.porc_costos / 100, 2), auth.uid()
  FROM public.movimientos m
  WHERE m.partner_id_atribucion = p_partner_id
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND m.tipo = 'egreso' AND m.estado <> 'anulado'
    -- DGG-260: un egreso revertido (o su contra-asiento) NO se congela en la rendición
    AND m.revertido_at IS NULL AND m.movimiento_revertido_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.egreso_pagos ep WHERE ep.movimiento_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.partner_id = p_partner_id AND pa.movimiento_id = m.id AND pa.rendicion_id <> v_rend_id);

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id, comprobante_id, movimiento_id, egreso_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido, created_by)
  SELECT p_partner_id, v_convenio.id, v_rend_id, NULL, NULL, eg.id, NULL,
    'costo', v_convenio.porc_costos, eg.total,
    ROUND(eg.total * v_convenio.porc_costos / 100, 2), auth.uid()
  FROM public.egresos eg
  WHERE eg.partner_id_atribucion = p_partner_id
    AND eg.estado = 'activo'
    AND eg.fecha BETWEEN p_desde AND p_hasta
    AND NOT EXISTS (SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.egreso_id = eg.id AND pa.rendicion_id <> v_rend_id);

  SELECT
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_atribuido END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_atribuido END), 0)
    INTO v_ing_brutos, v_ing_atrib, v_cos_brutos, v_cos_atrib
    FROM public.partner_atribuciones WHERE rendicion_id = v_rend_id;

  UPDATE public.partner_rendiciones
     SET total_ingresos_brutos = v_ing_brutos, total_ingresos_atribuidos = v_ing_atrib,
         total_costos_brutos = v_cos_brutos, total_costos_atribuidos = v_cos_atrib,
         updated_at = now()
   WHERE id = v_rend_id;

  RETURN v_rend_id;
END;
$function$;
