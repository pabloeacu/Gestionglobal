-- ============================================================================
-- 0248_partner_sabana.sql
-- DGG-85 (Fase B) · Sábana / resumen de cuenta del partner. REPORTE read-only —
-- NO toca operaciones ni la rendición existente.
--
-- Base = COBRADO (decisión de Pablo): una línea por COBRANZA (imputación)
-- atribuida al partner; participación = % vigente × lo cobrado en esa operación.
-- Un comprobante cobrado en partes => varias líneas; la suma llega a %×total al
-- cobrarse todo. Egresos = operación completa (chip 'total'); participación =
-- %costos × monto del egreso (resta). El % se toma del convenio vigente a la
-- FECHA de cada línea. Saldo corrido = Σ participación (ingreso +, egreso −).
--
-- chip: 'total' si la operación dejó el comprobante saldado (saldo_after≈0);
--       'parcial' si aún queda saldo pendiente del comprobante.
--
-- Paridad gerencia/partner: UNA sola RPC. Si el caller es partner → usa su propio
-- partner_id (ignora el arg). Si es staff → usa p_partner_id. Misma lógica para
-- ambos ⇒ ven exactamente lo mismo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.partner_sabana(
  p_partner_id uuid DEFAULT NULL,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS TABLE (
  fecha date,
  tipo text,
  descripcion text,
  comprobante_id uuid,
  comprobante_label text,
  cliente_nombre text,
  comprobante_total numeric,
  comprobante_saldo numeric,
  operacion_monto numeric,
  chip text,
  porcentaje numeric,
  participacion_monto numeric,
  saldo_participacion numeric,
  movimiento_id uuid,
  adjuntos_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner uuid;
  v_caller_partner uuid := private.current_partner_id();
BEGIN
  IF v_caller_partner IS NOT NULL THEN
    v_partner := v_caller_partner;           -- el partner sólo ve lo suyo
  ELSIF private.is_staff() THEN
    v_partner := p_partner_id;               -- gerencia elige el partner
  ELSE
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_partner IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH imp AS (
    SELECT
      m.fecha AS f, mi.created_at AS ord, mi.monto_imputado AS oper,
      c.id AS comp_id, c.tipo AS ctipo, c.punto_venta AS cpv, c.numero AS cnum,
      c.total AS ctotal, c.administracion_id AS adm_id, m.descripcion AS mdesc,
      m.id AS mov_id,
      c.total - SUM(mi.monto_imputado) OVER (
        PARTITION BY c.id ORDER BY m.fecha, mi.created_at, mi.id ROWS UNBOUNDED PRECEDING
      ) AS saldo_after,
      m.partner_id_atribucion AS pid
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
      AND m.tipo = 'ingreso' AND m.estado <> 'anulado'
    JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
    -- Sólo comprobantes con al menos una cobranza del partner (perf); la ventana
    -- de saldo igual recorre TODAS las imputaciones de esos comprobantes.
    WHERE c.id IN (
      SELECT mi2.comprobante_id
        FROM public.movimiento_imputaciones mi2
        JOIN public.movimientos m2 ON m2.id = mi2.movimiento_id
       WHERE m2.partner_id_atribucion = v_partner
         AND m2.tipo = 'ingreso' AND m2.estado <> 'anulado'
    )
  ),
  ingresos AS (
    SELECT
      i.f AS fecha, 'ingreso'::text AS tipo,
      COALESCE(NULLIF(i.mdesc,''), 'Cobranza') AS descripcion,
      i.comp_id AS comprobante_id,
      (i.ctipo || ' ' || lpad(i.cpv::text,5,'0') || '-' || lpad(COALESCE(i.cnum,0)::text,8,'0')) AS comprobante_label,
      a.nombre AS cliente_nombre,
      i.ctotal AS comprobante_total,
      GREATEST(i.saldo_after, 0) AS comprobante_saldo,
      i.oper AS operacion_monto,
      CASE WHEN i.saldo_after <= 0.009 THEN 'total' ELSE 'parcial' END AS chip,
      i.oper AS base, 'ingreso'::text AS conv_tipo, i.f AS conv_fecha,
      i.mov_id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = i.mov_id) AS adjuntos_count
    FROM imp i
    LEFT JOIN public.administraciones a ON a.id = i.adm_id
    WHERE i.pid = v_partner
  ),
  egresos AS (
    SELECT
      m.fecha AS fecha, 'egreso'::text AS tipo,
      COALESCE(NULLIF(m.descripcion,''), 'Egreso') AS descripcion,
      NULL::uuid AS comprobante_id, NULL::text AS comprobante_label,
      a.nombre AS cliente_nombre,
      NULL::numeric AS comprobante_total, NULL::numeric AS comprobante_saldo,
      m.monto AS operacion_monto, 'total'::text AS chip,
      m.monto AS base, 'costo'::text AS conv_tipo, m.fecha AS conv_fecha,
      m.id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = m.id) AS adjuntos_count
    FROM public.movimientos m
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE m.tipo = 'egreso' AND m.estado <> 'anulado'
      AND m.partner_id_atribucion = v_partner
  ),
  todos AS (
    SELECT * FROM ingresos
    UNION ALL
    SELECT * FROM egresos
  ),
  conpart AS (
    SELECT t.*,
      conv.porc,
      ROUND(t.base * COALESCE(conv.porc,0) / 100.0, 2) AS part_abs,
      CASE WHEN t.conv_tipo = 'ingreso' THEN 1 ELSE -1 END AS signo
    FROM todos t
    LEFT JOIN LATERAL (
      SELECT CASE WHEN t.conv_tipo = 'ingreso' THEN pc.porc_ingresos ELSE pc.porc_costos END AS porc
        FROM public.partner_convenios pc
       WHERE pc.partner_id = v_partner AND pc.activo
         AND pc.vigencia_desde <= t.conv_fecha
         AND (pc.vigencia_hasta IS NULL OR pc.vigencia_hasta >= t.conv_fecha)
       ORDER BY pc.vigencia_desde DESC LIMIT 1
    ) conv ON true
  ),
  corrido AS (
    SELECT cp.*,
      SUM(cp.part_abs * cp.signo) OVER (
        ORDER BY cp.fecha, cp.conv_tipo DESC, cp.comprobante_id NULLS LAST
        ROWS UNBOUNDED PRECEDING
      ) AS saldo_part
    FROM conpart cp
  )
  SELECT
    co.fecha, co.tipo, co.descripcion, co.comprobante_id, co.comprobante_label,
    co.cliente_nombre, co.comprobante_total, co.comprobante_saldo, co.operacion_monto,
    co.chip, COALESCE(co.porc,0)::numeric AS porcentaje,
    co.part_abs AS participacion_monto, co.saldo_part AS saldo_participacion,
    co.movimiento_id, co.adjuntos_count
  FROM corrido co
  WHERE (p_desde IS NULL OR co.fecha >= p_desde)
    AND (p_hasta IS NULL OR co.fecha <= p_hasta)
  ORDER BY co.fecha, co.conv_tipo DESC, co.comprobante_id NULLS LAST;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_sabana(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_sabana(uuid,date,date) TO authenticated;
