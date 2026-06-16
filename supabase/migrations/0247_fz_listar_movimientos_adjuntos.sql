-- ============================================================================
-- 0247_fz_listar_movimientos_adjuntos.sql
-- DGG-85 (Fase A) · fz_listar_movimientos devuelve adjuntos_count para el ícono
-- "clip" en la lista de movimientos. Cambia el RETURNS TABLE → DROP+CREATE (R16).
-- ============================================================================
DROP FUNCTION IF EXISTS public.fz_listar_movimientos(uuid, text, date, date, text, boolean, boolean, integer, integer);

CREATE FUNCTION public.fz_listar_movimientos(
  p_caja_id uuid DEFAULT NULL,
  p_tipo text DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_incluir_anulados boolean DEFAULT false,
  p_incluir_revertidos boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid, caja_id uuid, caja_nombre text, caja_color text,
  fecha date, tipo text, monto numeric, categoria_id uuid, categoria_nombre text,
  descripcion text, referencia text, administracion_id uuid, administracion_nombre text,
  estado text, origen text, revertido_at timestamptz,
  transferencia_pair_id uuid, movimiento_revertido_id uuid,
  adjuntos_count bigint, total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT
      m.id, m.caja_id, c.nombre AS caja_nombre, c.color AS caja_color,
      m.fecha, m.tipo, m.monto, m.categoria_id,
      cat.nombre AS categoria_nombre,
      m.descripcion, m.referencia,
      m.administracion_id, a.nombre AS administracion_nombre,
      m.estado, m.origen, m.revertido_at,
      m.transferencia_pair_id, m.movimiento_revertido_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = m.id) AS adjuntos_count
    FROM public.movimientos m
    JOIN public.cajas c ON c.id = m.caja_id
    LEFT JOIN public.categorias_finanzas cat ON cat.id = m.categoria_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE private.is_staff()
      AND (p_caja_id IS NULL OR m.caja_id = p_caja_id)
      AND (p_tipo IS NULL OR m.tipo = p_tipo)
      AND (p_fecha_desde IS NULL OR m.fecha >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR m.fecha <= p_fecha_hasta)
      AND (p_incluir_anulados OR m.estado <> 'anulado')
      AND (p_incluir_revertidos OR m.revertido_at IS NULL)
      AND (
        p_search IS NULL OR p_search = ''
        OR m.descripcion ILIKE '%'||p_search||'%'
        OR m.referencia ILIKE '%'||p_search||'%'
        OR a.nombre ILIKE '%'||p_search||'%'
      )
  ),
  with_count AS (
    SELECT *, COUNT(*) OVER() AS total_count FROM filtered
  )
  SELECT * FROM with_count
  ORDER BY fecha DESC, id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$$;
REVOKE EXECUTE ON FUNCTION public.fz_listar_movimientos(uuid, text, date, date, text, boolean, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_listar_movimientos(uuid, text, date, date, text, boolean, boolean, integer, integer) TO authenticated;
