-- 0686 · DGG-249 chunk 2/3 · Reportes: rentabilidad DEVENGADA del partner + pasivo KPI.
--
-- Hoy la rentabilidad del partner se computa BASE COBRADO: los costos salen sólo de
-- movimientos egreso PAGADOS → un gasto cargado-pero-impago es invisible e infla la
-- rentabilidad presunta (el hueco de Pablo). Con las obligaciones de egreso (DGG-249
-- chunk 1) ahora podemos sumar el costo DEVENGADO (pagado + impago) atribuido al partner.
--
-- Decisión de Pablo: devengado + transparente (el costo impago cuenta apenas se carga
-- la obligación, y el partner lo ve con chip pagado/parcial/impago).
--
-- NO DOBLE-CONTEO: costo devengado = Σ(obligaciones atribuidas · total)
--                                  + Σ(movimientos egreso atribuidos STANDALONE, los que
--                                      NO están ligados a una obligación vía egreso_pagos).
-- El pago de una obligación es un movimiento egreso (origen='pago_egreso') que ya está
-- cubierto por el total de la obligación → se EXCLUYE del leg cash. Invariante verificable:
-- devengado = pagado(movs egreso atribuidos) + impago(Σ saldo_pendiente obligaciones).
--
-- Paridad gerencia↔partner: se cambian las 3 superficies a la vez (partner_crear_rendicion,
-- partner_sabana, partner_rendicion_movimientos). Rendiciones cerradas: inmutables (crear
-- sólo corre en borrador; no se recalcula lo cerrado).

-- ── (1) 4ª vía de vínculo en partner_atribuciones: egreso_id (obligación de egreso).
ALTER TABLE public.partner_atribuciones
  ADD COLUMN IF NOT EXISTS egreso_id uuid REFERENCES public.egresos(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_pat_egreso ON public.partner_atribuciones (egreso_id) WHERE egreso_id IS NOT NULL;

-- XOR ampliado: exactamente UNO de {comprobante_id, movimiento_id, egreso_id}.
ALTER TABLE public.partner_atribuciones DROP CONSTRAINT chk_pat_xor;
ALTER TABLE public.partner_atribuciones ADD CONSTRAINT chk_pat_xor CHECK (
  ( (comprobante_id IS NOT NULL)::int
  + (movimiento_id  IS NOT NULL)::int
  + (egreso_id      IS NOT NULL)::int ) = 1
);

-- ── (2) partner_crear_rendicion: costo devengado (2 legs) + neto. Ingreso leg intacto.
CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(p_partner_id uuid, p_desde date, p_hasta date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  -- INGRESO leg (cobrado) — INTACTO.
  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id, comprobante_id, movimiento_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido, created_by)
  SELECT p_partner_id, v_convenio.id, v_rend_id, mi.comprobante_id, NULL, mi.id,
    'ingreso', v_convenio.porc_ingresos, mi.monto_imputado,
    ROUND(mi.monto_imputado * v_convenio.porc_ingresos / 100, 2), auth.uid()
  FROM public.movimiento_imputaciones mi
  JOIN public.movimientos m ON m.id = mi.movimiento_id
   AND m.tipo = 'ingreso' AND m.estado <> 'anulado' AND m.partner_id_atribucion = p_partner_id
  JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
  WHERE m.fecha BETWEEN p_desde AND p_hasta
    AND NOT EXISTS (SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.imputacion_id = mi.id AND pa.rendicion_id <> v_rend_id);

  -- COSTO leg A: movimientos egreso STANDALONE (NO ligados a una obligación de egreso).
  --   (DGG-249: excluimos los pagos de obligación — su costo lo aporta el total de la obligación, leg B).
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
    AND NOT EXISTS (SELECT 1 FROM public.egreso_pagos ep WHERE ep.movimiento_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.partner_id = p_partner_id AND pa.movimiento_id = m.id AND pa.rendicion_id <> v_rend_id);

  -- COSTO leg B: obligaciones de egreso DEVENGADAS (total = pagado + impago).
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
         updated_at = now()                                    -- `neto` es columna GENERADA (ing_atrib − cos_atrib): se autopobla.
   WHERE id = v_rend_id;

  RETURN v_rend_id;
END;
$function$;

-- ── (3) partner_sabana: egresos = standalone (pagados) ∪ obligaciones (devengadas, chip pagado/parcial/impago).
CREATE OR REPLACE FUNCTION public.partner_sabana(p_partner_id uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, comprobante_id uuid, comprobante_label text, cliente_nombre text, comprobante_total numeric, comprobante_saldo numeric, operacion_monto numeric, chip text, porcentaje numeric, participacion_monto numeric, saldo_participacion numeric, movimiento_id uuid, adjuntos_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
      c.total - SUM(mi.monto_imputado) OVER (
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
  -- Egreso STANDALONE (cash no ligado a obligación): ya pagado → chip 'total'
  -- (se mantiene el valor histórico para NO regresar la sábana del partner; el frontend
  --  actual mapea 'total'→Total. Los chips nuevos pagado/parcial/impago son sólo de las
  --  obligaciones devengadas, que el chunk 3 de UI mapea).
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
  -- Obligaciones DEVENGADAS (total) → chip pagado/parcial/impago (transparencia).
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

-- ── (4) partner_rendicion_movimientos: resolver las atribuciones por egreso_id (label desde egresos).
CREATE OR REPLACE FUNCTION public.partner_rendicion_movimientos(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(atribucion_id uuid, fecha date, tipo text, cliente_nombre text, servicio_nombre text, comprobante_label text, monto_base numeric, porcentaje numeric, monto_atribuido numeric, saldo_running numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_partner_id uuid;
BEGIN
  SELECT pr.partner_id INTO v_partner_id FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'partner';
  IF v_partner_id IS NULL THEN
    IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo partner o staff' USING ERRCODE = '42501'; END IF;
    RETURN;
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT pa.id AS atribucion_id,
        COALESCE(mc.fecha, m.fecha, c.fecha, eg.fecha) AS fecha,
        pa.tipo,
        COALESCE(a.nombre, eg.proveedor_nombre) AS cliente_nombre,
        COALESCE(det.detalle, eg.concepto) AS servicio_nombre,
        CASE WHEN c.id IS NOT NULL
          THEN c.tipo || ' ' || COALESCE(lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'), 's/n')
          WHEN eg.id IS NOT NULL
          THEN 'Obligación · ' || eg.proveedor_nombre
          ELSE COALESCE(m.descripcion, '—') END AS comprobante_label,
        pa.monto_base::numeric AS monto_base, pa.porcentaje::numeric AS porcentaje,
        pa.monto_atribuido::numeric AS monto_atribuido, pa.created_at
      FROM public.partner_atribuciones pa
      LEFT JOIN public.movimiento_imputaciones mi ON mi.id = pa.imputacion_id
      LEFT JOIN public.movimientos mc ON mc.id = mi.movimiento_id
      LEFT JOIN public.movimientos m ON m.id = pa.movimiento_id
      LEFT JOIN public.comprobantes c ON c.id = pa.comprobante_id
      LEFT JOIN public.egresos eg ON eg.id = pa.egreso_id
      LEFT JOIN public.administraciones a ON a.id = COALESCE(c.administracion_id, m.administracion_id, eg.administracion_id)
      LEFT JOIN LATERAL (
        SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
        FROM (
          SELECT NULLIF(trim(COALESCE(
                   (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                   (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                      FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion, MIN(ic.orden) AS min_orden
                              FROM public.items_comprobantes ic WHERE ic.comprobante_id = c.id GROUP BY 1) d
                     WHERE d.descripcion IS NOT NULL),
                   (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                     WHERE t.comprobante_id = c.id AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                     ORDER BY t.created_at, t.id LIMIT 1),
                   NULLIF(trim(c.concepto), '')
                 )), '') AS txt
        ) x
      ) det ON true
      WHERE pa.partner_id = v_partner_id
        AND (p_desde IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha, eg.fecha) >= p_desde)
        AND (p_hasta IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha, eg.fecha) <= p_hasta)
    ),
    dedup AS (
      SELECT DISTINCT ON (b.atribucion_id)
        b.atribucion_id, b.fecha, b.tipo, b.cliente_nombre, b.servicio_nombre, b.comprobante_label,
        b.monto_base, b.porcentaje, b.monto_atribuido, b.created_at
      FROM base b ORDER BY b.atribucion_id, b.servicio_nombre NULLS LAST
    ),
    ordenado AS (
      SELECT d.*,
        SUM(CASE WHEN d.tipo = 'ingreso' THEN d.monto_atribuido ELSE -d.monto_atribuido END)
          OVER (ORDER BY d.fecha ASC, d.created_at ASC) AS saldo_running
      FROM dedup d
    )
    SELECT o.atribucion_id, o.fecha, o.tipo, o.cliente_nombre, o.servicio_nombre, o.comprobante_label,
           o.monto_base, o.porcentaje, o.monto_atribuido, o.saldo_running
      FROM ordenado o ORDER BY o.fecha ASC, o.created_at ASC;
END;
$function$;

-- ── (5) kpis_dashboard_global: tarjeta de PASIVO (obligaciones de egreso pendientes de pago).
--        Aditivo: sólo agrega claves al jsonb; ningún lector existente se rompe.
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(p_desde date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp' SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_result jsonb; v_facturado_periodo numeric; v_cobrado_periodo numeric;
  v_deuda_total numeric; v_admins_morosos int; v_tramites_abiertos int;
  v_vencimientos_proximos int; v_serie jsonb;
  v_pasivo_total numeric; v_egreso_devengado_periodo numeric; v_egreso_pagado_periodo numeric;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(SUM(total),0) INTO v_facturado_periodo
    FROM comprobantes WHERE estado='autorizado' AND fecha >= p_desde;
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

  -- DGG-249: pasivo (obligaciones de egreso por pagar) + egreso devengado/pagado del período.
  SELECT COALESCE(SUM(saldo_pendiente),0) INTO v_pasivo_total
    FROM egresos WHERE estado='activo' AND saldo_pendiente > 0;
  SELECT COALESCE(SUM(total),0) INTO v_egreso_devengado_periodo
    FROM egresos WHERE estado='activo' AND fecha >= p_desde;
  SELECT COALESCE(SUM(monto),0) INTO v_egreso_pagado_periodo
    FROM movimientos WHERE tipo='egreso' AND estado <> 'anulado' AND revertido_at IS NULL AND fecha >= p_desde;

  SELECT jsonb_agg(jsonb_build_object('fecha',d,'facturado',COALESCE(daily,0)) ORDER BY d)
    INTO v_serie
    FROM (SELECT gs::date AS d,
            (SELECT COALESCE(SUM(total),0) FROM comprobantes WHERE estado='autorizado' AND fecha=gs::date) AS daily
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
$function$;
