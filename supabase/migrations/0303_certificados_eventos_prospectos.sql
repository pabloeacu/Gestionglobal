-- 0303 · Etapa B (Pablo) · Certificados de eventos para TODOS los asistentes,
-- incluidos los PROSPECTOS (sin cuenta). Hoy la emisión exige profile_id → sólo
-- clientes. Un asistente presencial sin cuenta (caso típico) quedaba sin nada.
--
-- Modelo: se relaja alumno_profile_id a nullable + se agrega prospecto_id, con
-- un CHECK de que todo cert tenga un destinatario (profile O prospecto). Los
-- certs de curso siguen con alumno_profile_id (no se rompe el XOR curso/webinar).
--
-- Emisión: nueva RPC `emitir_certificados_evento` que emite a clientes Y
-- prospectos con asistió=true (los ausentes NO reciben), devuelve los cert_ids
-- creados. NO encola email acá: el browser del gerente renderiza el PDF, lo sube
-- al bucket `certificados` y recién ahí dispara el mail con adjunto (B2/B3).

-- 1) Modelo -----------------------------------------------------------------
ALTER TABLE public.certificados ALTER COLUMN alumno_profile_id DROP NOT NULL;
ALTER TABLE public.certificados
  ADD COLUMN IF NOT EXISTS prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE SET NULL;

-- Todo cert tiene un destinatario. (Los cursos siempre traen alumno_profile_id,
-- así que las filas existentes ya cumplen.)
ALTER TABLE public.certificados DROP CONSTRAINT IF EXISTS cert_destinatario_chk;
ALTER TABLE public.certificados
  ADD CONSTRAINT cert_destinatario_chk
  CHECK (alumno_profile_id IS NOT NULL OR prospecto_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_certificados_prospecto
  ON public.certificados(prospecto_id) WHERE prospecto_id IS NOT NULL;

COMMENT ON COLUMN public.certificados.prospecto_id IS
  'Destinatario prospecto (sin cuenta) — se le manda el cert por mail con PDF adjunto. XOR informal con alumno_profile_id (ver cert_destinatario_chk).';

-- 2) RPC set pdf_storage_path (staff) --------------------------------------
-- El browser sube el PDF al bucket `certificados` y registra su path acá.
CREATE OR REPLACE FUNCTION public.certificado_registrar_pdf(p_cert_id uuid, p_path text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  UPDATE public.certificados SET pdf_storage_path = p_path, updated_at = now()
   WHERE id = p_cert_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.certificado_registrar_pdf(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certificado_registrar_pdf(uuid, text) TO authenticated;

-- 3) RPC emisión a TODOS los asistentes (clientes + prospectos) -------------
-- Gate: sólo asistió=true. Dedup por (webinar, profile) y (webinar, prospecto).
-- Devuelve los cert_ids creados (para que el browser renderice + suba + mailee).
CREATE OR REPLACE FUNCTION public.emitir_certificados_evento(p_webinar_id uuid)
 RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_web       public.webinars%ROWTYPE;
  v_esquema   jsonb;
  v_key       text;
  v_anio      text := to_char(now(), 'YYYY');
  r           record;
  v_nombre    text;
  v_codigo    text;
  v_hash      text;
  v_cert_id   uuid;
  v_out       uuid[] := '{}';
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = p_webinar_id;
  IF v_web.id IS NULL THEN RAISE EXCEPTION 'Evento inexistente' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(v_web.cert_emite, false) THEN
    RAISE EXCEPTION 'Este evento no emite certificados' USING ERRCODE = '22023';
  END IF;

  v_esquema := public.resolver_esquema_webinar(p_webinar_id);
  SELECT hmac_key INTO v_key FROM private.campus_secrets WHERE id = 1;

  FOR r IN
    SELECT wi.id AS inscripto_id, wi.profile_id, wi.prospecto_id,
           wi.nombre_snapshot, wi.email_snapshot
      FROM public.webinar_inscriptos wi
     WHERE wi.webinar_id = p_webinar_id
       AND COALESCE(wi.asistio, false) = true
       AND (wi.profile_id IS NOT NULL OR wi.prospecto_id IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.certificados c
          WHERE c.webinar_id = p_webinar_id
            AND ( (wi.profile_id   IS NOT NULL AND c.alumno_profile_id = wi.profile_id)
               OR (wi.prospecto_id IS NOT NULL AND c.prospecto_id      = wi.prospecto_id) )
       )
  LOOP
    v_nombre := COALESCE(
      (SELECT full_name FROM public.profiles WHERE id = r.profile_id),
      r.nombre_snapshot, 'Asistente');

    v_codigo := 'GG-EVT-' || v_anio || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
    v_hash := encode(extensions.hmac(
      v_codigo || '|evento|' || p_webinar_id::text || '|' || COALESCE(r.profile_id::text, r.prospecto_id::text)
        || '|' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      v_key, 'sha256'), 'hex');

    INSERT INTO public.certificados (
      webinar_id, curso_id, administracion_id, alumno_profile_id, prospecto_id,
      codigo, verificacion_hash, tema, payload_snapshot, esquema_snapshot
    ) VALUES (
      p_webinar_id, NULL, NULL, r.profile_id, r.prospecto_id,
      v_codigo, v_hash, 1,
      jsonb_build_object(
        'alumno_nombre', v_nombre,
        'curso_titulo', v_web.titulo,
        'instructor_nombre', NULL,
        'duracion_horas', round(v_web.duracion_min / 60.0, 1),
        'nota_examen', NULL,
        'emitido_at', now(),
        'origen', 'evento',
        'email', r.email_snapshot
      ),
      v_esquema
    )
    RETURNING id INTO v_cert_id;
    v_out := array_append(v_out, v_cert_id);
  END LOOP;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.emitir_certificados_evento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_certificados_evento(uuid) TO authenticated;
