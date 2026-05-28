-- ============================================================================
-- Migration: 0114_gerente_editar_avance_tracking
-- Fecha: 2026-05-28
-- DGG-XX · Bloque E / obs 9: la gerencia puede editar el texto de cualquier
-- avance de tracking, sea propio, de otro gerente o del gestor externo.
-- Útil para corregir tipos, completar info que el gestor escribió de apuro,
-- etc.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gerente_editar_avance_tracking(
  p_linea_id     uuid,
  p_descripcion  text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_linea_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede editar textos de avances'
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción no puede quedar vacía'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.tracking_lineas
     SET descripcion = trim(p_descripcion)
   WHERE id = p_linea_id
   RETURNING id INTO v_linea_id;
  IF v_linea_id IS NULL THEN
    RAISE EXCEPTION 'Avance no encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_linea_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gerente_editar_avance_tracking(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gerente_editar_avance_tracking(uuid, text) TO authenticated;
