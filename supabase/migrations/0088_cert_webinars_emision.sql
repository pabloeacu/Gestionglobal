-- ============================================================================
-- 0088 · Certificados de webinars (DGG-29 plan A · parte 2/2)
-- ============================================================================

-- 1. Hacer matricula_id y curso_id nullable + agregar webinar_id (XOR de origen)
ALTER TABLE public.certificados ALTER COLUMN matricula_id DROP NOT NULL;
ALTER TABLE public.certificados ALTER COLUMN curso_id DROP NOT NULL;
ALTER TABLE public.certificados
  ADD COLUMN webinar_id uuid REFERENCES public.webinars(id) ON DELETE SET NULL;
ALTER TABLE public.certificados ADD CONSTRAINT cert_origen_xor
  CHECK ((matricula_id IS NOT NULL)::int + (webinar_id IS NOT NULL)::int = 1);
CREATE INDEX certificados_webinar_id_idx ON public.certificados(webinar_id);

COMMENT ON CONSTRAINT cert_origen_xor ON public.certificados IS
  'Un certificado proviene de una matricula (curso) O de un webinar, no ambos.';

-- 2. Helper esquema webinar (paralelo a resolver_esquema_curso)
CREATE OR REPLACE FUNCTION public.resolver_esquema_webinar(p_webinar_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_esquema_id uuid;
  v_row public.certificado_esquemas%ROWTYPE;
BEGIN
  SELECT cert_esquema_id INTO v_esquema_id FROM public.webinars WHERE id = p_webinar_id;
  IF v_esquema_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.certificado_esquemas WHERE id = v_esquema_id;
    IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  END IF;
  SELECT * INTO v_row FROM public.certificado_esquemas WHERE es_default LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  RETURN NULL;
END;
$$;

-- 3. RPC para emitir cert a un asistente de webinar
CREATE OR REPLACE FUNCTION public.emitir_certificado_webinar(
  p_webinar_id uuid,
  p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_web       public.webinars%ROWTYPE;
  v_nombre    text;
  v_email     text;
  v_cert_id   uuid;
  v_codigo    text;
  v_hash      text;
  v_key       text;
  v_anio      text := to_char(now(), 'YYYY');
  v_existe    uuid;
  v_esquema   jsonb;
  v_inscripto public.webinar_inscriptos%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = p_webinar_id;
  IF v_web.id IS NULL THEN
    RAISE EXCEPTION 'Webinar inexistente' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(v_web.cert_emite, false) THEN
    RAISE EXCEPTION 'Este webinar no emite certificados' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existe
    FROM public.certificados
   WHERE webinar_id = p_webinar_id AND alumno_profile_id = p_profile_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT * INTO v_inscripto
    FROM public.webinar_inscriptos
   WHERE webinar_id = p_webinar_id AND profile_id = p_profile_id;
  IF v_inscripto.id IS NULL THEN
    RAISE EXCEPTION 'El asistente no está inscripto al webinar' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(full_name, v_inscripto.nombre_snapshot, 'Asistente') INTO v_nombre
    FROM public.profiles WHERE id = p_profile_id;

  v_codigo := 'GG-WEB-' || v_anio || '-'
              || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  SELECT hmac_key INTO v_key FROM private.campus_secrets WHERE id = 1;
  v_hash := encode(
    extensions.hmac(
      v_codigo || '|webinar|' || p_webinar_id::text || '|' || p_profile_id::text
        || '|' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      v_key, 'sha256'),
    'hex');

  v_esquema := public.resolver_esquema_webinar(p_webinar_id);

  INSERT INTO public.certificados (
    webinar_id, curso_id, administracion_id, alumno_profile_id,
    codigo, verificacion_hash, tema,
    payload_snapshot, esquema_snapshot
  ) VALUES (
    p_webinar_id, NULL, NULL, p_profile_id,
    v_codigo, v_hash, 1,
    jsonb_build_object(
      'alumno_nombre', v_nombre,
      'curso_titulo', v_web.titulo,
      'instructor_nombre', NULL,
      'duracion_horas', round(v_web.duracion_min / 60.0, 1),
      'nota_examen', NULL,
      'emitido_at', now(),
      'origen', 'webinar'
    ),
    v_esquema
  )
  RETURNING id INTO v_cert_id;

  v_email := COALESCE(
    (SELECT email FROM auth.users WHERE id = p_profile_id),
    v_inscripto.email_snapshot
  );
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'certificado-emitido', v_email, v_nombre,
      jsonb_build_object(
        'nombre', v_nombre,
        'nombre_curso', v_web.titulo,
        'codigo', v_codigo
      ),
      NULL, NULL, 'certificados', v_cert_id, 4::smallint
    );
    UPDATE public.certificados SET enviado_email_at = now() WHERE id = v_cert_id;
  END IF;
  RETURN v_cert_id;
END;
$$;

-- 4. Batch · emite cert a todos los asistentes con profile registrado
CREATE OR REPLACE FUNCTION public.emitir_certificados_webinar_lote(p_webinar_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record; v_count integer := 0; v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT DISTINCT wi.profile_id
      FROM public.webinar_inscriptos wi
     WHERE wi.webinar_id = p_webinar_id
       AND wi.profile_id IS NOT NULL
       AND COALESCE(wi.asistio, false) = true
       AND NOT EXISTS (
         SELECT 1 FROM public.certificados c
          WHERE c.webinar_id = p_webinar_id
            AND c.alumno_profile_id = wi.profile_id
       )
  LOOP
    v_id := public.emitir_certificado_webinar(p_webinar_id, r.profile_id);
    IF v_id IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
