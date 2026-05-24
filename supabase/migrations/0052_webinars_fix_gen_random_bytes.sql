-- 0052_webinars_fix_gen_random_bytes.sql
-- E-GG-16 · pgcrypto vive en schema `extensions`, no `public`. Las RPCs
-- SECURITY DEFINER con SET search_path = public, pg_temp NO encuentran
-- gen_random_bytes. Fix: usar extensions.gen_random_bytes() explícito.
-- (Mismo patrón que E-GG-05 / fix 0043 para generar_acceso_externo.)

CREATE OR REPLACE FUNCTION public.inscribir_a_webinar(
  p_webinar_id uuid,
  p_email text,
  p_nombre text,
  p_telefono text DEFAULT NULL,
  p_submission_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_webinar record;
  v_email_norm text;
  v_administracion_id uuid;
  v_profile_id uuid;
  v_prospecto_id uuid;
  v_zoom_count integer;
  v_canal text;
  v_inscripto_id uuid;
  v_token text;
  v_vence_at timestamptz;
  v_es_prospecto boolean;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_requerido' USING ERRCODE = '22023';
  END IF;
  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'nombre_requerido' USING ERRCODE = '22023';
  END IF;
  v_email_norm := lower(trim(p_email));

  SELECT * INTO v_webinar FROM public.webinars WHERE id = p_webinar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webinar_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_webinar.status = 'cancelado' THEN
    RAISE EXCEPTION 'webinar_cancelado' USING ERRCODE = '22023';
  END IF;
  IF now() > (v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval) THEN
    RAISE EXCEPTION 'inscripcion_cerrada' USING ERRCODE = '22023';
  END IF;

  SELECT wi.id INTO v_inscripto_id
    FROM public.webinar_inscriptos wi
   WHERE wi.webinar_id = p_webinar_id AND wi.email_snapshot = v_email_norm;
  IF FOUND THEN
    SELECT token INTO v_token
      FROM public.webinar_acceso_tokens
     WHERE webinar_inscripto_id = v_inscripto_id AND revocado_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_token IS NULL THEN
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      v_vence_at := v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval + interval '30 days';
      INSERT INTO public.webinar_acceso_tokens(token, webinar_inscripto_id, vence_at)
        VALUES (v_token, v_inscripto_id, v_vence_at);
    END IF;
    SELECT canal, administracion_id, prospecto_id
      INTO v_canal, v_administracion_id, v_prospecto_id
      FROM public.webinar_inscriptos WHERE id = v_inscripto_id;
    RETURN jsonb_build_object(
      'token', v_token, 'canal', v_canal, 'webinar_id', p_webinar_id,
      'inscripto_id', v_inscripto_id, 'es_prospecto', v_prospecto_id IS NOT NULL,
      'prospecto_id', v_prospecto_id, 'administracion_id', v_administracion_id,
      'ya_inscripto', true
    );
  END IF;

  SELECT id INTO v_administracion_id
    FROM public.administraciones
   WHERE lower(trim(email)) = v_email_norm LIMIT 1;
  IF v_administracion_id IS NOT NULL THEN
    SELECT id INTO v_profile_id
      FROM public.profiles
     WHERE lower(trim(email)) = v_email_norm AND administracion_id = v_administracion_id
     LIMIT 1;
  END IF;
  v_es_prospecto := v_administracion_id IS NULL;

  IF v_es_prospecto THEN
    INSERT INTO public.prospectos(nombre, email, telefono, origen)
    VALUES (trim(p_nombre), v_email_norm, p_telefono, 'webinar')
    ON CONFLICT (email) DO UPDATE
      SET nombre = COALESCE(EXCLUDED.nombre, public.prospectos.nombre),
          telefono = COALESCE(EXCLUDED.telefono, public.prospectos.telefono),
          updated_at = now()
    RETURNING id INTO v_prospecto_id;
  END IF;

  SELECT COUNT(*) INTO v_zoom_count
    FROM public.webinar_inscriptos
   WHERE webinar_id = p_webinar_id AND canal = 'zoom';

  IF v_webinar.cupo_zoom IS NOT NULL AND v_webinar.zoom_join_url IS NOT NULL
     AND v_zoom_count < v_webinar.cupo_zoom THEN
    v_canal := 'zoom';
  ELSIF v_webinar.youtube_live_url IS NOT NULL THEN
    v_canal := 'youtube';
  ELSE
    RAISE EXCEPTION 'webinar_sin_canales_disponibles' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.webinar_inscriptos(
    webinar_id, administracion_id, prospecto_id, profile_id,
    email_snapshot, nombre_snapshot, telefono_snapshot,
    canal, formulario_submission_id
  ) VALUES (
    p_webinar_id, v_administracion_id, v_prospecto_id, v_profile_id,
    v_email_norm, trim(p_nombre), p_telefono,
    v_canal, p_submission_id
  )
  RETURNING id INTO v_inscripto_id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_vence_at := v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval + interval '30 days';
  INSERT INTO public.webinar_acceso_tokens(token, webinar_inscripto_id, vence_at)
    VALUES (v_token, v_inscripto_id, v_vence_at);

  RETURN jsonb_build_object(
    'token', v_token, 'canal', v_canal, 'webinar_id', p_webinar_id,
    'inscripto_id', v_inscripto_id, 'es_prospecto', v_es_prospecto,
    'prospecto_id', v_prospecto_id, 'administracion_id', v_administracion_id,
    'ya_inscripto', false
  );
END;
$$;
