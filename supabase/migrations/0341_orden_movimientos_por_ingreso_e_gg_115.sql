-- 0341 · E-GG-115 (doc JL wave 6 · P6-A + barrido orden-temporal): los listados
-- de movimientos ordenan por fecha (DATE) desempatando con `id` (UUID v4
-- ALEATORIO) → dentro del mismo día el orden es arbitrario, no "lo último arriba".
-- movimientos/historico ya tienen created_at (timestamptz) pero no se usa.
--
-- Fix: agregar created_at DESC como desempate (id queda como tiebreaker final
-- determinístico para paginación estable). Misma firma → CREATE OR REPLACE (R16 ok).
-- NO se toca cuenta_corriente_extracto/cliente_ctacte_extracto: ya desempatan por
-- created_at ASC (correcto para el saldo corriente).

-- ── P6-A: fz_listar_movimientos (grilla de Movimientos de Cajas, gerencia) ─────
-- Se listan las 20 columnas del RETURNS TABLE explícitas (created_at se usa sólo
-- para ordenar, no se devuelve).
CREATE OR REPLACE FUNCTION public.fz_listar_movimientos(p_caja_id uuid DEFAULT NULL::uuid, p_tipo text DEFAULT NULL::text, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_search text DEFAULT NULL::text, p_incluir_anulados boolean DEFAULT false, p_incluir_revertidos boolean DEFAULT true, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, caja_id uuid, caja_nombre text, caja_color text, fecha date, tipo text, monto numeric, categoria_id uuid, categoria_nombre text, descripcion text, referencia text, administracion_id uuid, administracion_nombre text, estado text, origen text, revertido_at timestamp with time zone, transferencia_pair_id uuid, movimiento_revertido_id uuid, adjuntos_count bigint, total_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH filtered AS (
    SELECT
      m.id, m.caja_id, c.nombre AS caja_nombre, c.color AS caja_color,
      m.fecha, m.tipo, m.monto, m.categoria_id,
      cat.nombre AS categoria_nombre,
      m.descripcion, m.referencia,
      m.administracion_id, a.nombre AS administracion_nombre,
      m.estado, m.origen, m.revertido_at,
      m.transferencia_pair_id, m.movimiento_revertido_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = m.id) AS adjuntos_count,
      m.created_at
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
  SELECT
    id, caja_id, caja_nombre, caja_color, fecha, tipo, monto, categoria_id,
    categoria_nombre, descripcion, referencia, administracion_id, administracion_nombre,
    estado, origen, revertido_at, transferencia_pair_id, movimiento_revertido_id,
    adjuntos_count, total_count
  FROM with_count
  ORDER BY fecha DESC, created_at DESC, id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$function$;

-- ── Barrido: listar_creditos_administracion ordenaba SÓLO por fecha ────────────
DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.listar_creditos_administracion'::regproc) INTO v_def;
  v_def := replace(v_def, 'ORDER BY m.fecha DESC', 'ORDER BY m.fecha DESC, m.created_at DESC');
  EXECUTE v_def;
END $mig$;
