-- ============================================================================
-- 0200 · Campus · Endurecer exposición del examen al alumno (E-GG-52 · regla 3)
-- ----------------------------------------------------------------------------
-- Hallazgo (doble auditoría DGG-47): el loader del alumno `getCurso` hacía
-- `curso_opciones(*)` y `curso_preguntas(*)`, por lo que la respuesta correcta
-- (`curso_opciones.correcta`), la retroalimentación y la `explicacion` de cada
-- pregunta VIAJABAN al browser del alumno (visibles en Network) ANTES de
-- responder. La policy `curso_opciones_select` (0029) lo permitía a propósito,
-- confiando en que el front no las mostrara → seguridad por ocultamiento, que
-- viola la regla 3 ("sin secretos en el front") y rompe un examen evaluativo.
--
-- Fix a nivel DATOS:
--   (1) RPC `curso_examen_rendir(p_examen_id)` SECURITY DEFINER que devuelve el
--       examen + secciones + preguntas + opciones SANITIZADAS (sin `correcta`,
--       sin `retroalimentacion`, sin `explicacion`). El alumno rinde con esto.
--   (2) Endurecer la RLS de `curso_preguntas` y `curso_opciones`: el SELECT
--       directo queda SOLO para staff. El alumno accede al contenido del examen
--       únicamente por la RPC (la corrección server-side `curso_responder_examen`
--       y la nueva RPC son SECURITY DEFINER → leen igual, sin depender de RLS).
--
-- La justificación (`explicacion`) se revela recién al responder, vía el
-- `detalle` de `curso_responder_examen`.
-- Reglas: R3 (sin secretos en el front), R4, R12 (tenancy en la RPC).
-- ============================================================================

-- (1) RPC sanitizada para rendir ---------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_examen_rendir(p_examen_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_examen public.curso_examenes%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = p_examen_id;
  IF v_examen.id IS NULL THEN
    RAISE EXCEPTION 'Examen inexistente' USING ERRCODE = '22023';
  END IF;
  -- Tenancy (R12): sólo staff o un alumno matriculado en el curso del examen.
  IF NOT (private.is_staff() OR private.curso_matriculado(v_examen.curso_id)) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'examen', jsonb_build_object(
      'id', v_examen.id,
      'curso_id', v_examen.curso_id,
      'titulo', v_examen.titulo,
      'descripcion', v_examen.descripcion,
      'nota_aprobacion', v_examen.nota_aprobacion,
      'intentos_max', v_examen.intentos_max,
      'mostrar_resultados', v_examen.mostrar_resultados,
      'mezclar_preguntas', v_examen.mezclar_preguntas,
      'fecha_habilitacion', v_examen.fecha_habilitacion,
      'fecha_cierre', v_examen.fecha_cierre
    ),
    'secciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'titulo', s.titulo,
               'descripcion', s.descripcion, 'orden', s.orden) ORDER BY s.orden)
        FROM public.curso_examen_secciones s WHERE s.examen_id = p_examen_id
    ), '[]'::jsonb),
    'preguntas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id,
               'seccion_id', q.seccion_id,
               'orden', q.orden,
               'tipo', q.tipo,
               'enunciado', q.enunciado,
               'puntaje', q.puntaje,
               -- SIN correcta / retroalimentacion (anti-trampa).
               'opciones', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', o.id, 'orden', o.orden, 'texto', o.texto) ORDER BY o.orden)
                   FROM public.curso_opciones o WHERE o.pregunta_id = q.id
               ), '[]'::jsonb)
             ) ORDER BY q.orden)
        FROM public.curso_preguntas q WHERE q.examen_id = p_examen_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_examen_rendir(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_examen_rendir(uuid) TO authenticated;

-- (2) Endurecer RLS: SELECT directo de preguntas/opciones SOLO staff ----------
-- El alumno ya no lee estas tablas directo; usa la RPC sanitizada.
DROP POLICY IF EXISTS curso_preguntas_select ON public.curso_preguntas;
CREATE POLICY curso_preguntas_select ON public.curso_preguntas
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS curso_opciones_select ON public.curso_opciones;
CREATE POLICY curso_opciones_select ON public.curso_opciones
  FOR SELECT TO authenticated
  USING (private.is_staff());
