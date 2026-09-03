-- ============================================================================
-- 0462 · DGG-156 — "Movimientos" (ex "recientes"): paginado + fechas + optim.
-- ----------------------------------------------------------------------------
-- Pablo: capitalizar la lista de "Movimientos recientes" del dashboard de finanzas
-- en una vista completa (título "Movimientos", filtro por fechas def. últimos 30
-- días, paginado 50 con scroll interno) sin agregar una sección nueva, y
-- optimizar la consulta para que no se clave con muchas filas.
--
-- El RPC fz_listar_movimientos ya soporta caja/tipo/fechas/búsqueda/paginado, pero
-- calculaba dos cosas caras sobre TODO el conjunto filtrado (no sobre la página):
--   1. el subquery correlacionado `adjuntos_count` (una vez por CADA fila filtrada);
--   2. las columnas de join, materializadas por el COUNT(*) OVER().
-- Con miles de movimientos eso se clava. Reestructura: `base` (sólo el filtro) →
-- `total` (count) → `page` (orden + limit/offset) → SELECT final que hace los joins
-- de nombres y el adjuntos_count SÓLO sobre las ≤50 filas de la página.
-- Salida (RETURNS TABLE) y semántica IDÉNTICAS — es una optimización, no un cambio
-- de contrato. Misma firma → R16 no aplica.
--
-- + índice `idx_mov_fecha_orden (fecha DESC, created_at DESC, id DESC)`: el default
--   (todas las cajas + rango de fechas + ORDER BY fecha) no tenía índice usable
--   (el existente es (caja_id, fecha), inútil sin filtro de caja). Regla 11.
--   Verificado en vivo: EXPLAIN ANALYZE del path default usa este índice, 6ms.
--
-- INVARIANTE del que depende `total_count` (auditoría §6, hallazgo A#15/C#3): el
-- COUNT se cuenta sobre `base` (pre-JOIN a cajas) pero las filas se devuelven con
-- INNER JOIN cajas. Coinciden SÓLO porque `movimientos.caja_id` es
-- `NOT NULL REFERENCES cajas(id) ON DELETE RESTRICT` (mig 0005): todo movimiento
-- tiene exactamente una caja viva y ninguna caja con movimientos puede borrarse.
-- Si algún día esa FK pasara a ON DELETE SET NULL, `base` sobre-contaría filas que
-- el SELECT final descarta → habría que mover el count a post-JOIN.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mov_fecha_orden
  ON public.movimientos (fecha DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.fz_listar_movimientos(
  p_caja_id uuid DEFAULT NULL::uuid,
  p_tipo text DEFAULT NULL::text,
  p_fecha_desde date DEFAULT NULL::date,
  p_fecha_hasta date DEFAULT NULL::date,
  p_search text DEFAULT NULL::text,
  p_incluir_anulados boolean DEFAULT false,
  p_incluir_revertidos boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, caja_id uuid, caja_nombre text, caja_color text, fecha date, tipo text,
  monto numeric, categoria_id uuid, categoria_nombre text, descripcion text,
  referencia text, administracion_id uuid, administracion_nombre text, estado text,
  origen text, revertido_at timestamp with time zone, transferencia_pair_id uuid,
  movimiento_revertido_id uuid, adjuntos_count bigint, total_count bigint,
  identificado_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      m.id, m.caja_id, m.fecha, m.tipo, m.monto, m.categoria_id,
      m.descripcion, m.referencia, m.administracion_id, m.estado, m.origen,
      m.revertido_at, m.transferencia_pair_id, m.movimiento_revertido_id,
      m.identificado_at, m.created_at
    FROM public.movimientos m
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
  total AS (SELECT count(*)::bigint AS n FROM base),
  page AS (
    SELECT * FROM base
    ORDER BY fecha DESC, created_at DESC, id DESC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    OFFSET GREATEST(0, p_offset)
  )
  SELECT
    p.id, p.caja_id, c.nombre AS caja_nombre, c.color AS caja_color,
    p.fecha, p.tipo, p.monto, p.categoria_id, cat.nombre AS categoria_nombre,
    p.descripcion, p.referencia, p.administracion_id, a.nombre AS administracion_nombre,
    p.estado, p.origen, p.revertido_at, p.transferencia_pair_id, p.movimiento_revertido_id,
    (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = p.id) AS adjuntos_count,
    (SELECT n FROM total) AS total_count,
    p.identificado_at
  FROM page p
  JOIN public.cajas c ON c.id = p.caja_id
  LEFT JOIN public.categorias_finanzas cat ON cat.id = p.categoria_id
  LEFT JOIN public.administraciones a ON a.id = p.administracion_id
  ORDER BY p.fecha DESC, p.created_at DESC, p.id DESC;
$function$;
