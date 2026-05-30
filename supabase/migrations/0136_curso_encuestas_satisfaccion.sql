-- ============================================================================
-- Migration: 0136_curso_encuestas_satisfaccion
-- Fecha: 2026-05-30
-- DGG-XX · Encuesta de Satisfacción por curso (campus).
--
-- Modelo:
--   * `curso_encuestas` (1 por curso): titulo, descripcion, schema jsonb con
--     preguntas (escala_10, estrellas, multiple, texto), activa, requerida
--     para certificado.
--   * `curso_encuesta_respuestas` (1 por matrícula): respuestas + testimonio
--     opcional (nombre + foto + comentario + permite_publicar). El testimonio
--     queda registrado pero la gerencia maneja la publicación FUERA de la
--     plataforma; un flag `publicado` se marca a mano para no repetir uso.
--   * Bucket `encuesta-testimonios` (público lectura, write authenticated)
--     para las fotos.
--   * RPCs: encuesta_responder (cliente), encuesta_marcar_publicado y
--     encuesta_emular_de_curso (gerencia), matricula_cumple_encuesta
--     (gating del cert).
-- ============================================================================

-- 1 · Tabla curso_encuestas
CREATE TABLE IF NOT EXISTS public.curso_encuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL UNIQUE REFERENCES public.cursos(id) ON DELETE CASCADE,
  titulo text NOT NULL DEFAULT 'Encuesta de satisfacción',
  descripcion text,
  schema jsonb NOT NULL DEFAULT '{"preguntas": []}',
  activa boolean NOT NULL DEFAULT false,
  requerida_para_cert boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.curso_encuestas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curso_encuestas TO authenticated;

CREATE OR REPLACE FUNCTION public._curso_encuestas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_curso_encuestas_updated_at ON public.curso_encuestas;
CREATE TRIGGER trg_curso_encuestas_updated_at
  BEFORE UPDATE ON public.curso_encuestas
  FOR EACH ROW EXECUTE FUNCTION public._curso_encuestas_set_updated_at();

DROP POLICY IF EXISTS enc_gerencia ON public.curso_encuestas;
CREATE POLICY enc_gerencia ON public.curso_encuestas
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- El alumno matriculado puede leer la encuesta SI está activa.
DROP POLICY IF EXISTS enc_lectura_matriculados ON public.curso_encuestas;
CREATE POLICY enc_lectura_matriculados ON public.curso_encuestas
  FOR SELECT TO authenticated
  USING (
    activa
    AND EXISTS (
      SELECT 1 FROM public.curso_matriculas m
      WHERE m.curso_id = curso_encuestas.curso_id
        AND m.profile_id = auth.uid()
    )
  );

-- 2 · Tabla curso_encuesta_respuestas
CREATE TABLE IF NOT EXISTS public.curso_encuesta_respuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encuesta_id uuid NOT NULL REFERENCES public.curso_encuestas(id) ON DELETE CASCADE,
  matricula_id uuid NOT NULL UNIQUE REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  respuestas jsonb NOT NULL DEFAULT '{}',
  testimonio_nombre text,
  testimonio_foto_url text,
  testimonio_comentario text,
  permite_publicar boolean NOT NULL DEFAULT false,
  publicado boolean NOT NULL DEFAULT false,
  publicado_at timestamptz,
  publicado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.curso_encuesta_respuestas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curso_encuesta_respuestas TO authenticated;

CREATE INDEX IF NOT EXISTS idx_resp_encuesta ON public.curso_encuesta_respuestas(encuesta_id);
CREATE INDEX IF NOT EXISTS idx_resp_publicar
  ON public.curso_encuesta_respuestas(permite_publicar) WHERE permite_publicar;
CREATE INDEX IF NOT EXISTS idx_resp_publicado
  ON public.curso_encuesta_respuestas(publicado, created_at DESC);

DROP POLICY IF EXISTS resp_gerencia ON public.curso_encuesta_respuestas;
CREATE POLICY resp_gerencia ON public.curso_encuesta_respuestas
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS resp_mi_respuesta ON public.curso_encuesta_respuestas;
CREATE POLICY resp_mi_respuesta ON public.curso_encuesta_respuestas
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.curso_matriculas m
    WHERE m.id = curso_encuesta_respuestas.matricula_id
      AND m.profile_id = auth.uid()
  ));

-- 3 · Bucket fotos testimonios (público para lectura, write authenticated)
INSERT INTO storage.buckets (id, name, public)
VALUES ('encuesta-testimonios', 'encuesta-testimonios', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS encuesta_test_write_auth ON storage.objects;
CREATE POLICY encuesta_test_write_auth ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'encuesta-testimonios')
  WITH CHECK (bucket_id = 'encuesta-testimonios');

-- 4 · RPC encuesta_responder (cliente). Upsert por matrícula.
CREATE OR REPLACE FUNCTION public.encuesta_responder(
  p_matricula_id uuid,
  p_respuestas jsonb,
  p_testimonio jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_enc_id uuid;
  v_resp_id uuid;
  v_curso_id uuid;
  v_test_nombre text;
  v_test_foto text;
  v_test_com text;
  v_test_pub boolean;
BEGIN
  -- Dueño de la matrícula o staff
  IF NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m
    WHERE m.id = p_matricula_id AND m.profile_id = auth.uid()
  ) AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT curso_id INTO v_curso_id FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'Matrícula no existe' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_enc_id FROM public.curso_encuestas WHERE curso_id = v_curso_id;
  IF v_enc_id IS NULL THEN
    RAISE EXCEPTION 'Este curso no tiene encuesta configurada' USING ERRCODE = '22023';
  END IF;

  v_test_nombre := NULLIF(trim(p_testimonio->>'nombre'), '');
  v_test_foto   := NULLIF(trim(p_testimonio->>'foto_url'), '');
  v_test_com    := NULLIF(trim(p_testimonio->>'comentario'), '');
  v_test_pub    := COALESCE((p_testimonio->>'permite_publicar')::boolean, false);

  INSERT INTO public.curso_encuesta_respuestas (
    encuesta_id, matricula_id, respuestas,
    testimonio_nombre, testimonio_foto_url, testimonio_comentario, permite_publicar
  ) VALUES (
    v_enc_id, p_matricula_id, p_respuestas,
    v_test_nombre, v_test_foto, v_test_com, v_test_pub
  )
  ON CONFLICT (matricula_id) DO UPDATE SET
    respuestas             = EXCLUDED.respuestas,
    testimonio_nombre      = EXCLUDED.testimonio_nombre,
    testimonio_foto_url    = EXCLUDED.testimonio_foto_url,
    testimonio_comentario  = EXCLUDED.testimonio_comentario,
    permite_publicar       = EXCLUDED.permite_publicar
  RETURNING id INTO v_resp_id;

  RETURN v_resp_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_responder(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encuesta_responder(uuid, jsonb, jsonb) TO authenticated;

-- 5 · RPC encuesta_marcar_publicado (gerencia)
CREATE OR REPLACE FUNCTION public.encuesta_marcar_publicado(
  p_respuesta_id uuid,
  p_publicado boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede marcar publicado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.curso_encuesta_respuestas
     SET publicado = p_publicado,
         publicado_at = CASE WHEN p_publicado THEN NOW() ELSE NULL END,
         publicado_por = CASE WHEN p_publicado THEN auth.uid() ELSE NULL END
   WHERE id = p_respuesta_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_marcar_publicado(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encuesta_marcar_publicado(uuid, boolean) TO authenticated;

-- 6 · RPC encuesta_emular_de_curso (gerencia · clona schema)
CREATE OR REPLACE FUNCTION public.encuesta_emular_de_curso(
  p_curso_destino uuid,
  p_curso_origen uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_schema jsonb; v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  SELECT schema INTO v_schema FROM public.curso_encuestas WHERE curso_id = p_curso_origen;
  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'El curso origen no tiene encuesta' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.curso_encuestas (curso_id, schema, activa)
  VALUES (p_curso_destino, v_schema, false)
  ON CONFLICT (curso_id) DO UPDATE SET schema = EXCLUDED.schema
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_emular_de_curso(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encuesta_emular_de_curso(uuid, uuid) TO authenticated;

-- 7 · Helper para gating del certificado.
-- Devuelve TRUE si: no hay encuesta OR no es requerida OR ya respondió.
CREATE OR REPLACE FUNCTION public.matricula_cumple_encuesta(p_matricula_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m
    JOIN public.curso_encuestas e ON e.curso_id = m.curso_id
    WHERE m.id = p_matricula_id
      AND e.activa
      AND e.requerida_para_cert
      AND NOT EXISTS (
        SELECT 1 FROM public.curso_encuesta_respuestas r
        WHERE r.matricula_id = m.id AND r.encuesta_id = e.id
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.matricula_cumple_encuesta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matricula_cumple_encuesta(uuid) TO authenticated;

-- 8 · Lista de cursos disponibles para emular (los que tienen encuesta con
-- al menos 1 pregunta).
CREATE OR REPLACE FUNCTION public.encuesta_listar_emulables()
RETURNS TABLE(curso_id uuid, curso_titulo text, n_preguntas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    c.id, c.titulo,
    jsonb_array_length(COALESCE(e.schema -> 'preguntas', '[]'::jsonb))
  FROM public.curso_encuestas e
  JOIN public.cursos c ON c.id = e.curso_id
  WHERE jsonb_array_length(COALESCE(e.schema -> 'preguntas', '[]'::jsonb)) > 0
  ORDER BY c.titulo;
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_listar_emulables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encuesta_listar_emulables() TO authenticated;
