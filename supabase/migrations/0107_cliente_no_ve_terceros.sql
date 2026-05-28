-- ============================================================================
-- Migration: 0107_cliente_no_ve_terceros
-- Fecha: 2026-05-28
-- DGG-XX · El cliente nunca debe percibir gestoría externa ni partners.
-- cliente_tracking_lineas: cuando categoria='gestor_avance' devuelve label
-- "Avance del trámite" y descripción sin el prefijo "✉️ Aporte de gestoría
-- externa (…):\n\n". La gerencia sigue viendo descripción y label originales
-- a través de su propia query (sin transformación).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_tracking_lineas(p_tramite_id uuid)
RETURNS TABLE (
  id uuid,
  categoria_slug text,
  categoria_label text,
  categoria_icono text,
  categoria_color text,
  descripcion text,
  archivos_urls text[],
  autor_nombre text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := private.current_administracion_id();
BEGIN
  IF v_admin_id IS NULL AND NOT private.is_staff() THEN
    RETURN;
  END IF;

  IF NOT private.is_staff() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = p_tramite_id AND t.administracion_id = v_admin_id
    ) THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
    SELECT tl.id,
           tl.categoria,
           CASE WHEN tl.categoria = 'gestor_avance'
                THEN 'Avance del trámite'
                ELSE COALESCE(cc.label, tl.categoria) END,
           COALESCE(cc.icono, 'circle'),
           COALESCE(cc.color, 'slate'),
           CASE WHEN tl.categoria = 'gestor_avance'
                  AND tl.descripcion ~ '^✉️ Aporte de gestoría externa'
                THEN regexp_replace(tl.descripcion,
                       '^✉️ Aporte de gestoría externa \([^)]+\):\s*', '')
                ELSE tl.descripcion END,
           COALESCE(tl.archivos_urls, '{}'::text[]),
           'Gestión Global'::text,
           tl.created_at
      FROM public.tracking_lineas tl
      LEFT JOIN public.tracking_categorias_config cc
        ON cc.slug = tl.categoria AND cc.servicio_id IS NULL
     WHERE tl.tramite_id = p_tramite_id
       AND tl.visible_cliente = true
     ORDER BY tl.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_tracking_lineas(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cliente_tracking_lineas(uuid) TO authenticated;
