-- ============================================================================
-- 0181 · DGG-38 · Bucket "tramite-documento-final" + auto-cierre cert Campus
--
-- (1) Bucket público para subir documentos finales al cerrar un trámite
--     (certificados, diplomas, PDFs). Antes solo se aceptaba URL externa;
--     ahora el modal de cierre permite subir archivo Y/O pegar URL.
--     Público porque el documento_final_url se comparte con el cliente y
--     queremos URLs estables (no signed con expiración).
--
-- (2) Trigger AFTER INSERT en `certificados` → si el cert proviene de una
--     matrícula con submission_origen, busca el trámite correspondiente
--     (categoria='curso', formulario_submission_id = matricula.submission_origen,
--     estado ≠ cerrado/cancelado) y lo cierra automáticamente. Inserta
--     línea automática "Aprobación exitosa del curso con emisión de
--     certificado" en `tracking_lineas` con autor_id=NULL (sistema).
--     SECURITY DEFINER (R17: tracking_lineas tiene RLS, este trigger
--     escribe en ella desde contexto sin usuario).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) Bucket público
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tramite-documento-final',
  'tramite-documento-final',
  true,                     -- público: el URL se comparte con el cliente
  20971520,                 -- 20 MB
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
) ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Solo staff puede subir/modificar. Lectura es pública (bucket público).
DROP POLICY IF EXISTS "tramite_doc_final_staff_rw" ON storage.objects;
CREATE POLICY "tramite_doc_final_staff_rw"
ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'tramite-documento-final' AND private.is_staff())
WITH CHECK (bucket_id = 'tramite-documento-final' AND private.is_staff());

-- ----------------------------------------------------------------------------
-- (2) Trigger: cert emitido → cierra trámite curso correspondiente
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_certificado_cierra_tramite_curso_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_submission_id uuid;
  v_tramite_id    uuid;
  v_url           text;
BEGIN
  -- 1. Obtener submission_origen desde la matrícula
  SELECT submission_origen INTO v_submission_id
  FROM public.curso_matriculas
  WHERE id = NEW.matricula_id;

  IF v_submission_id IS NULL THEN
    -- El alumno fue inscripto manualmente, no hay trámite asociado
    RETURN NEW;
  END IF;

  -- 2. Buscar trámite curso ABIERTO con esa submission
  SELECT id INTO v_tramite_id
  FROM public.tramites
  WHERE formulario_submission_id = v_submission_id
    AND categoria = 'curso'
    AND estado NOT IN ('cerrado', 'cancelado')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_tramite_id IS NULL THEN
    -- No hay trámite curso abierto que cerrar
    RETURN NEW;
  END IF;

  -- 3. URL pública de verificación del certificado
  v_url := 'https://gestionglobal.ar/verificar/' || NEW.codigo;

  -- 4. Cerrar el trámite
  UPDATE public.tramites
     SET estado = 'cerrado',
         fecha_fin = CURRENT_DATE,
         documento_final_url = v_url,
         resuelto_at = COALESCE(resuelto_at, now()),
         resuelto_por = COALESCE(resuelto_por, NULL),  -- sistema
         ultima_actividad_at = now()
   WHERE id = v_tramite_id;

  -- 5. Línea automática del sistema
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    v_tramite_id,
    'certificado_emitido',
    'Aprobación exitosa del curso con emisión de certificado.',
    'finalizado',
    ARRAY[v_url]::text[],
    NULL,    -- sistema
    true     -- visible para el cliente / alumno
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca abortar la emisión del cert por un fallo del side-effect
  RAISE WARNING 'trg_certificado_cierra_tramite_curso fallo: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_certificado_cierra_tramite_curso ON public.certificados;
CREATE TRIGGER trg_certificado_cierra_tramite_curso
AFTER INSERT ON public.certificados
FOR EACH ROW EXECUTE FUNCTION public.trg_certificado_cierra_tramite_curso_fn();

COMMENT ON FUNCTION public.trg_certificado_cierra_tramite_curso_fn() IS
  'DGG-38 (2026-06-02): cuando se emite un certificado del Campus a un alumno '
  'cuya matrícula vino de un formulario público (submission_origen NOT NULL), '
  'cierra automáticamente el trámite curso correspondiente con documento_final_url '
  'apuntando a la página pública de verificación, e inserta una línea de sistema '
  '"Aprobación exitosa del curso con emisión de certificado". El gerente ya no '
  'tiene que cerrar manualmente cursos cuando el cert se emite solo.';
