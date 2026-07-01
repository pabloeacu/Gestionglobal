-- ============================================================================
-- 0267_curso_desasignar_alumno.sql
-- DGG-92 (reporte JL #4) · Gerencia necesita poder DESASIGNAR (y volver a asignar,
-- sin límite) alumnos de un curso del campus. Sólo existía curso_asignar_alumno.
-- Desasignar = DELETE físico de la matrícula: las tablas hijas (curso_progreso,
-- examen_intentos, matricula_condiciones, curso_encuentro_asistencias,
-- curso_encuentro_zoom_eventos, curso_encuesta_respuestas) son ON DELETE CASCADE.
-- La tabla certificados es ON DELETE RESTRICT → si el alumno YA tiene certificado
-- emitido, se bloquea con un mensaje claro (hay que anular el cert primero) en
-- lugar del error críptico de FK. Tras el DELETE, curso_asignar_alumno vuelve a
-- insertar fresh (uq_curso_matricula queda libre) → re-asignar sin límite.
--
-- Guard E-GG-75: private.is_staff() devuelve NULL con auth.uid() NULL → un
-- `IF NOT is_staff()` no dispararía. Se abre con `IF auth.uid() IS NULL THEN
-- RAISE` (defensa en profundidad; la función además está REVOKEda de anon).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.curso_desasignar_alumno(p_matricula_id uuid)
 RETURNS uuid  -- devuelve el curso_id afectado
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mat public.curso_matriculas%ROWTYPE;
  v_cert_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede desasignar alumnos de un curso' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mat FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La matrícula no existe' USING ERRCODE = 'P0002';
  END IF;

  -- tenancy (mismo patrón que curso_asignar_alumno; gerentes bypassan)
  IF v_mat.administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(v_mat.administracion_id);
  END IF;

  -- guard: certificado emitido ⇒ FK RESTRICT lo bloquearía con error críptico
  SELECT count(*) INTO v_cert_count FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_cert_count > 0 THEN
    RAISE EXCEPTION 'Este alumno tiene un certificado emitido para este curso. Anulá el certificado antes de desasignarlo.'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.curso_matriculas WHERE id = p_matricula_id;
  RETURN v_mat.curso_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.curso_desasignar_alumno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_desasignar_alumno(uuid) TO authenticated;
