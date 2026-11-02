-- ============================================================================
-- Mig 0150 · A5 · Limpiar datos de prueba del Campus
-- Borra los 2 cursos seed creados en mig 0029 (Rick Astley + zoom.us/j/000).
-- El curso real `formacion-inicial-administradores` se preserva.
-- ============================================================================

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.certificados c
  JOIN public.curso_matriculas m ON m.id = c.matricula_id
  JOIN public.cursos cu ON cu.id = m.curso_id
  WHERE cu.slug IN ('curso-administradores-formacion-rpac',
                    'curso-administradores-actualizacion')
    AND c.revocado_at IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Hay % certificados emitidos vigentes en cursos seed. Abortando.', v_count;
  END IF;

  DELETE FROM public.cursos
  WHERE slug IN ('curso-administradores-formacion-rpac',
                 'curso-administradores-actualizacion');

  RAISE NOTICE 'Cursos seed/demo eliminados.';
END $$;