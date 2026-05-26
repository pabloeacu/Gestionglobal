-- ============================================================================
-- 0072_analitica_avanzada · DGG-39 / P2-#24
--
-- 5 RPCs para alimentar gráficos del dashboard /gerencia/analitica:
--   • analitica_facturacion_mensual(meses) → serie temporal facturación
--   • analitica_cobranzas_mensual(meses) → serie temporal cobranzas
--   • analitica_top_clientes(dias, limit) → ranking por facturación
--   • analitica_mix_servicios(dias) → distribución de servicios vendidos
--   • analitica_funnel(dias) → conversión solicitudes → activadas
--
-- Todas SECURITY DEFINER, sólo staff (regla 12 / E45). Excluyen anulados y
-- reversiones (consistente con DGG-23 reportes financieros).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analitica_facturacion_mensual(p_meses int DEFAULT 12)
RETURNS TABLE(mes date, total numeric, cantidad int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now()) - (p_meses - 1) * INTERVAL '1 month',
      date_trunc('month', now()),
      INTERVAL '1 month'
    )::date AS mes
  )
  SELECT m.mes,
         COALESCE(SUM(c.total), 0)::numeric,
         COALESCE(COUNT(c.id) FILTER (WHERE c.id IS NOT NULL), 0)::int
  FROM meses m
  LEFT JOIN public.comprobantes c
    ON date_trunc('month', c.fecha) = m.mes
    AND c.estado NOT IN ('anulado', 'borrador')
    AND (private.is_staff() OR c.administracion_id = private.current_administracion_id())
  GROUP BY m.mes
  ORDER BY m.mes;
$$;

CREATE OR REPLACE FUNCTION public.analitica_cobranzas_mensual(p_meses int DEFAULT 12)
RETURNS TABLE(mes date, total numeric, cantidad int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now()) - (p_meses - 1) * INTERVAL '1 month',
      date_trunc('month', now()),
      INTERVAL '1 month'
    )::date AS mes
  )
  SELECT m.mes,
         COALESCE(SUM(mv.monto), 0)::numeric,
         COALESCE(COUNT(mv.id) FILTER (WHERE mv.id IS NOT NULL), 0)::int
  FROM meses m
  LEFT JOIN public.movimientos mv
    ON date_trunc('month', mv.fecha) = m.mes
    AND mv.tipo = 'ingreso'
    AND mv.revertido_at IS NULL
  WHERE private.is_staff()
  GROUP BY m.mes
  ORDER BY m.mes;
$$;

CREATE OR REPLACE FUNCTION public.analitica_top_clientes(p_dias int DEFAULT 90, p_limit int DEFAULT 10)
RETURNS TABLE(administracion_id uuid, nombre text, total_facturado numeric, total_comprobantes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.administracion_id, COALESCE(a.nombre, '(sin admin)'),
         COALESCE(SUM(c.total), 0)::numeric, COUNT(c.id)::int
  FROM public.comprobantes c
  LEFT JOIN public.administraciones a ON a.id = c.administracion_id
  WHERE private.is_staff()
    AND c.fecha >= (now() - p_dias * INTERVAL '1 day')::date
    AND c.estado NOT IN ('anulado', 'borrador')
  GROUP BY c.administracion_id, a.nombre
  ORDER BY 3 DESC
  LIMIT LEAST(p_limit, 50);
$$;

CREATE OR REPLACE FUNCTION public.analitica_mix_servicios(p_dias int DEFAULT 90)
RETURNS TABLE(servicio_id uuid, nombre text, total numeric, cantidad int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ic.servicio_id, COALESCE(s.nombre, ic.descripcion, '(sin servicio)'),
         COALESCE(SUM(ic.subtotal), 0)::numeric, COUNT(ic.id)::int
  FROM public.items_comprobantes ic
  JOIN public.comprobantes c ON c.id = ic.comprobante_id
  LEFT JOIN public.servicios s ON s.id = ic.servicio_id
  WHERE private.is_staff()
    AND c.fecha >= (now() - p_dias * INTERVAL '1 day')::date
    AND c.estado NOT IN ('anulado', 'borrador')
  GROUP BY ic.servicio_id, s.nombre, ic.descripcion
  ORDER BY 3 DESC
  LIMIT 12;
$$;

CREATE OR REPLACE FUNCTION public.analitica_funnel(p_dias int DEFAULT 90)
RETURNS TABLE(etapa text, cantidad int, orden int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM (
    SELECT 'recibidas'::text AS etapa, COUNT(*)::int AS cantidad, 1 AS orden
     FROM public.solicitudes
     WHERE private.is_staff() AND created_at >= (now() - p_dias * INTERVAL '1 day')
    UNION ALL
    SELECT 'en revisión'::text, COUNT(*)::int, 2
     FROM public.solicitudes
     WHERE private.is_staff() AND created_at >= (now() - p_dias * INTERVAL '1 day')
       AND estado IN ('en_revision','derivada','activada')
    UNION ALL
    SELECT 'derivadas'::text, COUNT(*)::int, 3
     FROM public.solicitudes
     WHERE private.is_staff() AND created_at >= (now() - p_dias * INTERVAL '1 day')
       AND estado IN ('derivada','activada')
    UNION ALL
    SELECT 'activadas'::text, COUNT(*)::int, 4
     FROM public.solicitudes
     WHERE private.is_staff() AND created_at >= (now() - p_dias * INTERVAL '1 day')
       AND estado = 'activada'
  ) sub
  ORDER BY orden;
$$;

GRANT EXECUTE ON FUNCTION public.analitica_facturacion_mensual(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analitica_cobranzas_mensual(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analitica_top_clientes(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analitica_mix_servicios(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analitica_funnel(int) TO authenticated;
