-- ============================================================================
-- 0460 · DGG-152 — "Regenerar certificado" (sólo gerencia).
-- ----------------------------------------------------------------------------
-- Pablo: un alumno se inscribió con el nombre de fantasía de su empresa
-- ("Grupo Florín") siendo persona física; hizo el curso y el certificado salió a
-- nombre de la empresa. Se corrigió el nombre en la ficha (profiles.full_name),
-- pero el certificado NO cambia porque congela el nombre en payload_snapshot al
-- emitir (igual que un comprobante snapshotea al receptor). Caso recurrente
-- (también: alguien tipeó mal su apellido y lo nota recién en el certificado).
--
-- Solución: RPC que RE-GENERA el certificado existente pisando su snapshot con
-- los datos ACTUALES (nombre de la ficha, nota, curso, esquema). Mantiene el
-- MISMO código, hash de verificación y fecha de emisión → la URL de verificación
-- y el link ya compartido siguen válidos; sólo se corrige el contenido. Como el
-- PDF se genera del snapshot (client-side), esto arregla la descarga de gerencia,
-- la del alumno en el portal y la página pública de verificación de una sola vez.
-- Sólo gerencia (private.is_staff). No re-notifica por mail (decisión: el alumno
-- ve el corregido en su próxima descarga; re-enviar sería otra acción).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.regenerar_certificado(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cert    public.certificados%ROWTYPE;
  v_mat     public.curso_matriculas%ROWTYPE;
  v_curso   public.cursos%ROWTYPE;
  v_nombre  text;
  v_nota    numeric;
  v_tema    smallint;
  v_esquema jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede regenerar certificados' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cert FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_cert.id IS NULL THEN
    RAISE EXCEPTION 'No hay certificado emitido para esta matrícula; no hay nada que regenerar'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_cert.revocado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El certificado está revocado; no se puede regenerar' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mat   FROM public.curso_matriculas WHERE id = p_matricula_id;
  SELECT * INTO v_curso FROM public.cursos WHERE id = v_mat.curso_id;
  SELECT COALESCE(full_name, 'Alumno') INTO v_nombre
    FROM public.profiles WHERE id = v_mat.profile_id;
  SELECT max(ei.nota) INTO v_nota
    FROM public.examen_intentos ei
    JOIN public.curso_examenes ce ON ce.id = ei.examen_id
   WHERE ei.matricula_id = p_matricula_id
     AND ei.aprobado = true
     AND ce.curso_id = v_mat.curso_id;
  v_tema    := public.gg_campus_tema_certificado(v_mat.curso_id);
  v_esquema := public.resolver_esquema_curso(v_mat.curso_id);

  -- Pisa el snapshot con los datos actuales; conserva código, hash, emitido_at,
  -- enviado_email_at y descargado_alumno_at (es una CORRECCIÓN, no una re-emisión).
  UPDATE public.certificados SET
    nota_examen       = v_nota,
    instructor_nombre = v_curso.instructor_nombre,
    tema              = v_tema,
    esquema_snapshot  = v_esquema,
    payload_snapshot  = jsonb_build_object(
      'alumno_nombre',     v_nombre,
      'curso_titulo',      v_curso.titulo,
      'instructor_nombre', v_curso.instructor_nombre,
      'duracion_horas',    v_curso.duracion_horas,
      'nota_examen',       v_nota,
      'emitido_at',        v_cert.emitido_at
    ),
    updated_at        = now()
  WHERE id = v_cert.id;

  RETURN v_cert.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.regenerar_certificado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_certificado(uuid) TO authenticated;
