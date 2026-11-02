-- ============================================================================
-- Mig 0152 · 6.F · Agregar columna tracking_id al output de proximos_vencimientos.
-- Permite a la UI mostrar el chip "generado desde tracking" y linkear al detalle.
-- ============================================================================

DROP FUNCTION IF EXISTS public.proximos_vencimientos(uuid, smallint);

CREATE OR REPLACE FUNCTION public.proximos_vencimientos(
  p_administracion_id uuid DEFAULT NULL,
  p_dias smallint DEFAULT 90
)
RETURNS TABLE (
  id uuid,
  tipo text,
  sujeto text,
  sujeto_id uuid,
  administracion_id uuid,
  administracion_nombre text,
  consorcio_id uuid,
  consorcio_nombre text,
  fecha_vencimiento date,
  fecha_emision date,
  dias_restantes int,
  descripcion text,
  observaciones text,
  estado text,
  sugerencia_servicio_slug text,
  alerta_30d_enviada timestamptz,
  alerta_20d_enviada timestamptz,
  alerta_10d_enviada timestamptz,
  tracking_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_filter uuid := p_administracion_id;
BEGIN
  IF NOT private.is_staff() THEN
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE = '42501';
    END IF;
  ELSIF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.tipo,
    v.sujeto,
    v.sujeto_id,
    v.administracion_id,
    a.nombre AS administracion_nombre,
    v.consorcio_id,
    c.nombre AS consorcio_nombre,
    v.fecha_vencimiento,
    v.fecha_emision,
    (v.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes,
    v.descripcion,
    v.observaciones,
    v.estado,
    COALESCE(
      cfg_override.sugerencia_servicio_slug,
      cfg_global.sugerencia_servicio_slug
    ) AS sugerencia_servicio_slug,
    v.alerta_30d_enviada,
    v.alerta_20d_enviada,
    v.alerta_10d_enviada,
    v.tracking_id
  FROM public.vencimientos v
  JOIN public.administraciones a ON a.id = v.administracion_id
  LEFT JOIN public.consorcios c ON c.id = v.consorcio_id
  LEFT JOIN public.vencimientos_config cfg_override
    ON cfg_override.administracion_id = v.administracion_id
   AND cfg_override.tipo = v.tipo
  LEFT JOIN public.vencimientos_config cfg_global
    ON cfg_global.administracion_id IS NULL
   AND cfg_global.tipo = v.tipo
  WHERE v.estado IN ('vigente','vencido')
    AND v.fecha_vencimiento <= CURRENT_DATE + p_dias
    AND (v_admin_filter IS NULL OR v.administracion_id = v_admin_filter)
  ORDER BY v.fecha_vencimiento ASC, v.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  TO authenticated;