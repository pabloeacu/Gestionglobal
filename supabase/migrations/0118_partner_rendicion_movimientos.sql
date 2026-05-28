-- ============================================================================
-- Migration: 0118_partner_rendicion_movimientos
-- Fecha: 2026-05-28
-- DGG-XX · Bloque D / obs 8 · Rendición detallada del partner.
-- Devuelve un movimiento por fila con cliente, servicio, monto bruto, %
-- convenio, monto atribuido y saldo evolutivo (ingreso suma / egreso resta).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.partner_rendicion_movimientos(
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS TABLE(
  atribucion_id     uuid,
  fecha             date,
  tipo              text,
  cliente_nombre    text,
  servicio_nombre   text,
  comprobante_label text,
  monto_base        numeric,
  porcentaje        numeric,
  monto_atribuido   numeric,
  saldo_running     numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT pr.partner_id INTO v_partner_id
    FROM public.profiles pr
   WHERE pr.id = auth.uid() AND pr.role = 'partner';
  IF v_partner_id IS NULL THEN
    IF NOT private.is_staff() THEN
      RAISE EXCEPTION 'Solo partner o staff' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT
        pa.id AS atribucion_id,
        COALESCE(m.fecha, c.fecha) AS fecha,
        pa.tipo,
        a.nombre AS cliente_nombre,
        sv.nombre AS servicio_nombre,
        CASE WHEN c.id IS NOT NULL
          THEN c.tipo || ' ' ||
               COALESCE(lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'), 's/n')
          ELSE COALESCE(m.descripcion, '—') END AS comprobante_label,
        pa.monto_base::numeric AS monto_base,
        pa.porcentaje::numeric AS porcentaje,
        pa.monto_atribuido::numeric AS monto_atribuido,
        pa.created_at
      FROM public.partner_atribuciones pa
      LEFT JOIN public.movimientos m ON m.id = pa.movimiento_id
      LEFT JOIN public.comprobantes c ON c.id = pa.comprobante_id
      LEFT JOIN public.administraciones a ON a.id = COALESCE(c.administracion_id, m.administracion_id)
      LEFT JOIN public.comprobante_items ci ON ci.comprobante_id = c.id
      LEFT JOIN public.servicios sv ON sv.id = ci.servicio_id
      WHERE pa.partner_id = v_partner_id
        AND (p_desde IS NULL OR COALESCE(m.fecha, c.fecha) >= p_desde)
        AND (p_hasta IS NULL OR COALESCE(m.fecha, c.fecha) <= p_hasta)
    ),
    dedup AS (
      SELECT DISTINCT ON (atribucion_id)
        atribucion_id, fecha, tipo, cliente_nombre,
        servicio_nombre, comprobante_label, monto_base, porcentaje,
        monto_atribuido, created_at
      FROM base
      ORDER BY atribucion_id, servicio_nombre NULLS LAST
    ),
    ordenado AS (
      SELECT *,
        SUM(
          CASE WHEN tipo = 'ingreso' THEN monto_atribuido
               ELSE -monto_atribuido END
        ) OVER (ORDER BY fecha ASC, created_at ASC) AS saldo_running
      FROM dedup
    )
    SELECT atribucion_id, fecha, tipo, cliente_nombre,
           servicio_nombre, comprobante_label, monto_base, porcentaje,
           monto_atribuido, saldo_running
      FROM ordenado
      ORDER BY fecha ASC, created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_rendicion_movimientos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.partner_rendicion_movimientos(date, date) TO authenticated;
