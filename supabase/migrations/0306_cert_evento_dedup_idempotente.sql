-- 0306 · Etapa B (hallazgo §6 Agente A #6) · idempotencia del dedup de certs de
-- evento a nivel BD. El dedup de `emitir_certificados_evento` era sólo un
-- `NOT EXISTS` dentro del RPC + el `disabled` del botón (UI). Dos invocaciones
-- concurrentes (doble-click muy rápido / dos pestañas) podían ambas pasar el
-- chequeo e insertar certs duplicados para el mismo asistente → doble email al
-- cliente. Cerramos con índices únicos parciales (SÓLO certs de evento, para no
-- tocar los certs de curso que tienen webinar_id NULL) + `ON CONFLICT DO NOTHING`
-- en el loop. Misma firma → CREATE OR REPLACE (R16).

-- Índices únicos parciales: un cert por (evento, cliente) y por (evento, prospecto).
-- Restringidos a webinar_id NOT NULL para no interferir con certs de curso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_evento_cliente
  ON public.certificados (webinar_id, alumno_profile_id)
  WHERE webinar_id IS NOT NULL AND alumno_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_evento_prospecto
  ON public.certificados (webinar_id, prospecto_id)
  WHERE webinar_id IS NOT NULL AND prospecto_id IS NOT NULL;

-- RPC con ON CONFLICT DO NOTHING (segunda capa: race de dos llamadas simultáneas).
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

  -- Crear las filas faltantes (asistentes sin cert todavía).
  FOR r IN
    SELECT wi.profile_id, wi.prospecto_id, wi.nombre_snapshot, wi.email_snapshot
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
    -- ON CONFLICT DO NOTHING: si una llamada concurrente ya insertó el cert de
    -- este asistente (índices uq_cert_evento_*), lo saltamos en vez de duplicar.
    INSERT INTO public.certificados (
      webinar_id, curso_id, administracion_id, alumno_profile_id, prospecto_id,
      codigo, verificacion_hash, tema, payload_snapshot, esquema_snapshot
    ) VALUES (
      p_webinar_id, NULL, NULL, r.profile_id, r.prospecto_id,
      v_codigo, v_hash, 1,
      jsonb_build_object(
        'alumno_nombre', v_nombre, 'curso_titulo', v_web.titulo,
        'instructor_nombre', NULL, 'duracion_horas', round(v_web.duracion_min / 60.0, 1),
        'nota_examen', NULL, 'emitido_at', now(), 'origen', 'evento', 'email', r.email_snapshot),
      v_esquema
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Devolver TODOS los certs del evento que aún no tienen PDF (nuevos +
  -- pendientes por fallo previo) → el browser los renderiza/sube/mailea.
  SELECT COALESCE(array_agg(id), '{}') INTO v_out
    FROM public.certificados
   WHERE webinar_id = p_webinar_id
     AND pdf_storage_path IS NULL
     AND revocado_at IS NULL;

  RETURN v_out;
END;
$function$;
