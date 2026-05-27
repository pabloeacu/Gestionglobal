-- ============================================================================
-- 0087 · Cerrar ciclo del certificado (DGG-29 / Plan A)
-- 1. Helper resolver_esquema_curso(curso_id) → devuelve jsonb del esquema
-- 2. emitir_certificado guarda esquema_snapshot
-- 3. emitir_certificado_si_corresponde respeta cursos.cert_emite_auto
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolver_esquema_curso(p_curso_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_esquema_id uuid;
  v_row public.certificado_esquemas%ROWTYPE;
BEGIN
  SELECT cert_esquema_id INTO v_esquema_id FROM public.cursos WHERE id = p_curso_id;
  IF v_esquema_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.certificado_esquemas WHERE id = v_esquema_id;
    IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  END IF;
  SELECT * INTO v_row FROM public.certificado_esquemas WHERE es_default LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  RETURN NULL;
END;
$$;

-- emitir_certificado ahora guarda esquema_snapshot
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

-- si_corresponde respeta gate cert_emite_auto
CREATE OR REPLACE FUNCTION public.emitir_certificado_si_corresponde(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer; v_cumplidas integer; v_existe uuid;
  v_curso_id uuid; v_auto boolean;
BEGIN
  SELECT id INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT m.curso_id INTO v_curso_id FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  SELECT cert_emite_auto INTO v_auto FROM public.cursos WHERE id = v_curso_id;
  IF NOT COALESCE(v_auto, true) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida)
    INTO v_total, v_cumplidas
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;
  IF v_total IS NULL OR v_total = 0 OR v_cumplidas < v_total THEN
    RETURN NULL;
  END IF;
  RETURN public.emitir_certificado(p_matricula_id);
END;
$$;
