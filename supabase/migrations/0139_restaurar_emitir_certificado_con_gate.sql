-- ============================================================================
-- Mig 0139 · Restaurar emitir_certificado completa de 0087 + gate de encuesta.
-- Las migs 0137 y 0138 dejaron una versión simplificada que perdió:
--   · auth.uid()/is_staff() guard (gerencia-only)
--   · v_mat ROWTYPE + lookup de profile / curso
--   · cálculo de v_codigo con sufijo de slug + año + gen_random_bytes hex
--   · HMAC sha256 de verificación
--   · payload_snapshot completo con datos del alumno y curso
--   · esquema_snapshot via resolver_esquema_curso(curso_id)
--   · INSERT con todas las columnas reales (esquema_id NO existe, era bug)
--   · encolar email "certificado-emitido" + marcar enviado_email_at
-- Volvemos a la versión original e insertamos el gate de encuesta antes del
-- chequeo de condiciones para que el mensaje al gerente sea claro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emitir_certificado(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mat       public.curso_matriculas%ROWTYPE;
  v_curso     public.cursos%ROWTYPE;
  v_nombre    text;
  v_email     text;
  v_total     integer;
  v_cumplidas integer;
  v_cert_id   uuid;
  v_codigo    text;
  v_hash      text;
  v_key       text;
  v_nota      numeric;
  v_tema      smallint;
  v_anio      text := to_char(now(), 'YYYY');
  v_sufijo    text;
  v_existe    public.certificados%ROWTYPE;
  v_esquema   jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mat FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_mat.id IS NULL THEN
    RAISE EXCEPTION 'Matricula inexistente' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe.id IS NOT NULL THEN
    RETURN v_existe.id;
  END IF;

  -- Mig 0137/0139: gate de encuesta. Si requiere encuesta y no respondió, bloquear.
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RAISE EXCEPTION 'No se puede emitir: el alumno todavía no respondió la encuesta de satisfacción (requerida para este curso).'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida)
    INTO v_total, v_cumplidas
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;
  IF v_total IS NULL OR v_total = 0 THEN
    RAISE EXCEPTION 'El curso no tiene condiciones activas configuradas; no se puede emitir certificado'
      USING ERRCODE = '22023';
  END IF;
  IF v_cumplidas < v_total THEN
    RAISE EXCEPTION 'Faltan condiciones por cumplir (%/%)', v_cumplidas, v_total
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_curso FROM public.cursos WHERE id = v_mat.curso_id;
  SELECT COALESCE(full_name, 'Alumno') INTO v_nombre
    FROM public.profiles WHERE id = v_mat.profile_id;
  SELECT max(ei.nota) INTO v_nota
    FROM public.examen_intentos ei
    JOIN public.curso_examenes ce ON ce.id = ei.examen_id
   WHERE ei.matricula_id = p_matricula_id
     AND ei.aprobado = true
     AND ce.curso_id = v_mat.curso_id;
  v_tema := public.gg_campus_tema_certificado(v_mat.curso_id);
  v_sufijo := upper(substr(replace(regexp_replace(v_curso.slug, '[^a-zA-Z]', '', 'g'), '-', ''), 1, 4));
  IF v_sufijo IS NULL OR length(v_sufijo) = 0 THEN v_sufijo := 'CERT'; END IF;
  v_codigo := 'GG-' || v_sufijo || '-' || v_anio || '-'
              || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  SELECT hmac_key INTO v_key FROM private.campus_secrets WHERE id = 1;
  v_hash := encode(
    extensions.hmac(
      v_codigo || '|' || v_mat.curso_id::text || '|' || v_mat.profile_id::text
        || '|' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      v_key, 'sha256'),
    'hex');

  v_esquema := public.resolver_esquema_curso(v_mat.curso_id);

  INSERT INTO public.certificados (
    matricula_id, curso_id, administracion_id, alumno_profile_id,
    codigo, verificacion_hash, nota_examen, instructor_nombre, tema,
    payload_snapshot, esquema_snapshot
  ) VALUES (
    p_matricula_id, v_mat.curso_id, v_mat.administracion_id, v_mat.profile_id,
    v_codigo, v_hash, v_nota, v_curso.instructor_nombre, v_tema,
    jsonb_build_object(
      'alumno_nombre', v_nombre,
      'curso_titulo', v_curso.titulo,
      'instructor_nombre', v_curso.instructor_nombre,
      'duracion_horas', v_curso.duracion_horas,
      'nota_examen', v_nota,
      'emitido_at', now()
    ),
    v_esquema
  )
  RETURNING id INTO v_cert_id;

  v_email := (SELECT email FROM auth.users WHERE id = v_mat.profile_id);
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'certificado-emitido', v_email, v_nombre,
      jsonb_build_object('nombre', v_nombre, 'nombre_curso', v_curso.titulo, 'codigo', v_codigo),
      NULL, NULL, 'certificados', v_cert_id, 4::smallint
    );
    UPDATE public.certificados SET enviado_email_at = now() WHERE id = v_cert_id;
  END IF;
  RETURN v_cert_id;
END;
$$;
