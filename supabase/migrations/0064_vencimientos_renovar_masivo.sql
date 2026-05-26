-- ============================================================================
-- 0064_vencimientos_renovar_masivo · DGG-34 / P5-6.B
--
-- Bulk renovar vencimientos: RPC que toma un array de IDs y un array paralelo
-- de fechas nuevas, y llama internamente a `marcar_renovado` por cada uno.
-- Devuelve filas {original_id, nuevo_id, error}. La operación es atómica:
-- si una falla, toda la transacción se aborta (mejor UX que estados
-- parcialmente aplicados — el usuario corrige y reintenta).
--
-- Validación inline:
--   • Los arrays deben tener el mismo length.
--   • Cada nueva fecha debe ser estrictamente posterior a la actual.
--   • Cada vencimiento debe pertenecer a la administración del caller
--     (delegado a `marcar_renovado`, que ya valida).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.marcar_renovados_masivo(
  p_ids uuid[],
  p_nuevas_fechas date[]
)
RETURNS TABLE(original_id uuid, nuevo_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i int;
  total int;
  v_nuevo uuid;
BEGIN
  IF p_ids IS NULL OR p_nuevas_fechas IS NULL THEN
    RAISE EXCEPTION 'Parámetros vacíos';
  END IF;
  total := array_length(p_ids, 1);
  IF total IS NULL OR total = 0 THEN
    RAISE EXCEPTION 'No se enviaron IDs para renovar';
  END IF;
  IF array_length(p_nuevas_fechas, 1) <> total THEN
    RAISE EXCEPTION 'IDs y fechas deben tener la misma cantidad (%, %)',
      total, array_length(p_nuevas_fechas, 1);
  END IF;

  FOR i IN 1..total LOOP
    -- marcar_renovado ya valida tenancy + que la nueva fecha sea > actual.
    v_nuevo := public.marcar_renovado(p_ids[i], p_nuevas_fechas[i]);
    original_id := p_ids[i];
    nuevo_id := v_nuevo;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_renovados_masivo(uuid[], date[])
  TO authenticated;

COMMENT ON FUNCTION public.marcar_renovados_masivo(uuid[], date[]) IS
  'DGG-34 / P5-6.B. Bulk renovación de vencimientos. Atómico: cualquier error '
  'aborta toda la operación. Delega validaciones por fila a marcar_renovado.';
