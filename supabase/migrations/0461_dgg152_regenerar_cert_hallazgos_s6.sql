-- ============================================================================
-- 0461 · DGG-152 — hallazgos §6 (3 revisores) sobre regenerar_certificado (0460).
-- ----------------------------------------------------------------------------
-- El núcleo (0460) quedó correcto y seguro (gate falla-cerrado, R16, grants,
-- preserva codigo/hash/emitido_at, propaga a verificación y descargas). Se cierran
-- los riesgos de diseño que cazó la auditoría:
--   1. nota_examen podía pisarse a NULL si se borraron los intentos aprobados de un
--      cert ya emitido → COALESCE(recompute, nota_actual): nunca blanquea una nota.
--   2. pdf_storage_path no se limpiaba → un PDF viejo guardado quedaría adjunto en
--      el mail (latente: hoy 0 certs de curso lo usan). Se setea a NULL (descarta el
--      viejo; el PDF se regenera del snapshot).
--   3. Sin rastro de auditoría de la mutación de un doc oficial → historial liviano
--      en payload_snapshot._regen_historial (actor, nombre anterior→nuevo, fecha).
--      La clave la ignora el generador de PDF (lee sólo las 6 conocidas) → inocua.
--   4. Copy: el gate admite gerente Y operador (is_staff); el mensaje decía "sólo
--      gerencia" → se ajusta a "equipo de gestión" (no era hueco: operador es staff).
-- (Intencional, NO se toca: regenerar re-lee todos los datos del curso/examen — es
--  el pedido explícito "asume los datos nuevamente". Sólo se blinda la nota.)
-- CREATE OR REPLACE, misma firma → R16 no aplica.
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
  v_hist    jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede regenerar certificados' USING ERRCODE = '42501';
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
  -- Hallazgo #1: nunca blanquear una nota ya emitida si el recompute da NULL.
  v_nota    := COALESCE(v_nota, v_cert.nota_examen);
  v_tema    := public.gg_campus_tema_certificado(v_mat.curso_id);
  v_esquema := public.resolver_esquema_curso(v_mat.curso_id);

  -- Hallazgo #3: rastro de auditoría liviano (append al historial previo).
  v_hist := COALESCE(v_cert.payload_snapshot->'_regen_historial', '[]'::jsonb)
    || jsonb_build_object(
         'at', now(),
         'por', auth.uid(),
         'nombre_anterior', v_cert.payload_snapshot->>'alumno_nombre',
         'nombre_nuevo', v_nombre
       );

  UPDATE public.certificados SET
    nota_examen       = v_nota,
    instructor_nombre = v_curso.instructor_nombre,
    tema              = v_tema,
    esquema_snapshot  = v_esquema,
    pdf_storage_path  = NULL,  -- hallazgo #2: descarta cualquier PDF viejo guardado
    payload_snapshot  = jsonb_build_object(
      'alumno_nombre',     v_nombre,
      'curso_titulo',      v_curso.titulo,
      'instructor_nombre', v_curso.instructor_nombre,
      'duracion_horas',    v_curso.duracion_horas,
      'nota_examen',       v_nota,
      'emitido_at',        v_cert.emitido_at,
      '_regen_historial',  v_hist
    ),
    updated_at        = now()
  WHERE id = v_cert.id;

  RETURN v_cert.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.regenerar_certificado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_certificado(uuid) TO authenticated;
