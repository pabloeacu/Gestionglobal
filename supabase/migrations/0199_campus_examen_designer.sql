-- ============================================================================
-- 0199 · Campus · Diseñador de exámenes completo (DGG-47)
-- ----------------------------------------------------------------------------
-- Suma al motor de exámenes lo que faltaba para cargar exámenes reales tipo
-- "Examen Curso de Actualización FUNDPLATA 2026 (RPAC-PBA)":
--   (1) SECCIONES temáticas dentro de un examen (título + descripción) →
--       tabla curso_examen_secciones + curso_preguntas.seccion_id.
--   (2) EXPLICACIÓN / justificación por pregunta (curso_preguntas.explicacion)
--       que se muestra al alumno al responder.
--   (3) RPC atómica curso_iniciar_intento (regla 4: la lógica del intento vive
--       en BD; mensaje claro al agotar intentos; reemplaza el read-then-insert
--       del front).
--   (4) curso_responder_examen ahora devuelve `explicacion` por pregunta en el
--       detalle (el alumno ve la justificación; `correcta` NUNCA sale por
--       separado al front — P-CAMPUS-01 / regla 3, la corrección es server-side).
--
-- El cálculo de nota NO cambia: puntaje ponderado por pregunta → porcentaje
-- sobre el total → aprueba si nota% >= nota_aprobacion. (Coincide EXACTO con la
-- consigna: "verdaderas suman, falsas no restan", 60/100 = 60%.)
--
-- Reglas: R2 (RLS en toda tabla), R4 (lógica multi-paso en BD), R6 (GRANT
-- explícito en CREATE TABLE post-0130), R16 (curso_responder_examen mantiene su
-- firma (uuid,jsonb) → CREATE OR REPLACE no genera overload), R18 (smoke e2e de
-- la RPC se corre por separado tras aplicar — necesita contexto auth.uid()).
-- ============================================================================

-- ===========================================================================
-- 1. Secciones temáticas dentro de un examen
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.curso_examen_secciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  examen_id uuid NOT NULL REFERENCES public.curso_examenes(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 0,
  titulo text NOT NULL,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curso_examen_secciones_examen
  ON public.curso_examen_secciones(examen_id, orden);

ALTER TABLE public.curso_examen_secciones ENABLE ROW LEVEL SECURITY;
-- R6: GRANT explícito (Supabase no concede por default desde 30/10/2026).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curso_examen_secciones TO authenticated;

-- RLS espeja curso_preguntas: SELECT staff o matriculado del curso; CUD solo staff.
DROP POLICY IF EXISTS curso_examen_secciones_select ON public.curso_examen_secciones;
CREATE POLICY curso_examen_secciones_select ON public.curso_examen_secciones
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(
      (SELECT curso_id FROM public.curso_examenes WHERE id = examen_id)
    )
  );
DROP POLICY IF EXISTS curso_examen_secciones_cud ON public.curso_examen_secciones;
CREATE POLICY curso_examen_secciones_cud ON public.curso_examen_secciones
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ===========================================================================
-- 2. Pregunta: pertenencia a sección + explicación/justificación
-- ===========================================================================
ALTER TABLE public.curso_preguntas
  ADD COLUMN IF NOT EXISTS seccion_id uuid
    REFERENCES public.curso_examen_secciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS explicacion text;

CREATE INDEX IF NOT EXISTS idx_curso_preguntas_seccion
  ON public.curso_preguntas(seccion_id) WHERE seccion_id IS NOT NULL;

COMMENT ON COLUMN public.curso_preguntas.explicacion IS
  'Justificación que se muestra al alumno al responder. Se devuelve por RPC; nunca se expone correcta client-side (regla 3 / P-CAMPUS-01).';

-- ===========================================================================
-- 3. RPC atómica para iniciar un intento (regla 4)
--    Reemplaza el read-then-insert del front; serializa con advisory lock para
--    que el doble-click no genere errores feos de UNIQUE.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.curso_iniciar_intento(
  p_examen_id uuid,
  p_matricula_id uuid
) RETURNS public.examen_intentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_next  smallint;
  v_row   public.examen_intentos;
BEGIN
  SELECT profile_id INTO v_owner
    FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  -- Tenancy: el alumno sólo arranca su propio intento; staff puede.
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  -- Serializa arranques concurrentes por (matrícula, examen).
  PERFORM pg_advisory_xact_lock(
    hashtext(p_matricula_id::text || ':' || p_examen_id::text));

  SELECT COALESCE(max(intento), 0) + 1 INTO v_next
    FROM public.examen_intentos
   WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id;

  -- El trigger BEFORE INSERT curso_examenes_ventana_check valida la ventana de
  -- fechas y el tope intentos_max, con mensaje claro al agotarse.
  INSERT INTO public.examen_intentos (matricula_id, examen_id, intento)
  VALUES (p_matricula_id, p_examen_id, v_next)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_iniciar_intento(uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_iniciar_intento(uuid, uuid)
  TO authenticated;

-- ===========================================================================
-- 4. curso_responder_examen: agrega `explicacion` al detalle por pregunta.
--    MISMA FIRMA (uuid, jsonb) → CREATE OR REPLACE no crea overload (R16).
--    El cálculo de nota es idéntico al original.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.curso_responder_examen(
  p_intento_id uuid,
  p_respuestas jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_intento public.examen_intentos%ROWTYPE;
  v_examen public.curso_examenes%ROWTYPE;
  v_owner uuid;
  v_pregunta record;
  v_resp jsonb;
  v_total_puntos integer := 0;
  v_obtenidos integer := 0;
  v_pendientes integer := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_correcta boolean;
  v_seleccion_correcta boolean;
  v_nota smallint;
  v_aprobado boolean;
BEGIN
  SELECT * INTO v_intento FROM public.examen_intentos WHERE id = p_intento_id;
  IF v_intento.id IS NULL THEN
    RAISE EXCEPTION 'Intento inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_intento.terminado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El intento ya está cerrado' USING ERRCODE = '22023';
  END IF;

  SELECT profile_id INTO v_owner
    FROM public.curso_matriculas WHERE id = v_intento.matricula_id;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = v_intento.examen_id;

  -- Iteramos las preguntas reales del examen (no las del payload) para evitar
  -- inyección de puntajes.
  FOR v_pregunta IN
    SELECT id, tipo, puntaje, explicacion FROM public.curso_preguntas
     WHERE examen_id = v_examen.id ORDER BY orden
  LOOP
    v_total_puntos := v_total_puntos + v_pregunta.puntaje;
    v_resp := (
      SELECT r FROM jsonb_array_elements(COALESCE(p_respuestas, '[]'::jsonb)) AS r
       WHERE (r->>'pregunta_id')::uuid = v_pregunta.id
       LIMIT 1
    );

    IF v_pregunta.tipo IN ('multiple_choice','verdadero_falso') THEN
      -- Correcta si las opciones marcadas coinciden EXACTO con las correctas.
      IF v_resp IS NULL THEN
        v_correcta := false;
      ELSE
        SELECT NOT EXISTS (
          -- alguna correcta no marcada
          SELECT 1 FROM public.curso_opciones o
           WHERE o.pregunta_id = v_pregunta.id AND o.correcta = true
             AND NOT (o.id::text = ANY (
               SELECT jsonb_array_elements_text(COALESCE(v_resp->'opcion_ids','[]'::jsonb))
             ))
        ) AND NOT EXISTS (
          -- alguna incorrecta marcada
          SELECT 1 FROM public.curso_opciones o
           WHERE o.pregunta_id = v_pregunta.id AND o.correcta = false
             AND o.id::text = ANY (
               SELECT jsonb_array_elements_text(COALESCE(v_resp->'opcion_ids','[]'::jsonb))
             )
        )
        INTO v_seleccion_correcta;
        v_correcta := COALESCE(v_seleccion_correcta, false);
      END IF;

      IF v_correcta THEN
        v_obtenidos := v_obtenidos + v_pregunta.puntaje;
      END IF;
      v_detalle := v_detalle || jsonb_build_object(
        'pregunta_id', v_pregunta.id,
        'correcta', v_correcta,
        'puntaje', CASE WHEN v_correcta THEN v_pregunta.puntaje ELSE 0 END,
        'pendiente_revision', false,
        'explicacion', v_pregunta.explicacion
      );
    ELSE
      -- texto_corto: queda pendiente revisión humana, no suma puntaje.
      v_pendientes := v_pendientes + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'pregunta_id', v_pregunta.id,
        'correcta', NULL,
        'puntaje', 0,
        'pendiente_revision', true,
        'explicacion', v_pregunta.explicacion
      );
    END IF;
  END LOOP;

  v_nota := CASE WHEN v_total_puntos > 0
                 THEN round((v_obtenidos::numeric / v_total_puntos) * 100)
                 ELSE 0 END;
  v_aprobado := (v_pendientes = 0) AND (v_nota >= v_examen.nota_aprobacion);

  UPDATE public.examen_intentos
     SET respuestas = COALESCE(p_respuestas, '[]'::jsonb),
         terminado_at = now(),
         nota = v_nota,
         aprobado = v_aprobado
   WHERE id = p_intento_id;

  RETURN jsonb_build_object(
    'nota', v_nota,
    'aprobado', v_aprobado,
    'pendientes_revision', v_pendientes,
    'detalle', v_detalle
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_responder_examen(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_responder_examen(uuid, jsonb)
  TO authenticated;
