-- 0292 · Fixes de la doble auditoría §6 del feature Eventos:
--
-- (A · crítico, lógica) inscribir_a_webinar: en modalidad 'mixto', si el
--     inscripto elige presencial PERO el cupo presencial está lleno, antes se
--     rechazaba con 'webinar_sin_cupo_presencial' aunque el evento tuviera canal
--     online. Ahora cae a online (zoom FCFS → youtube) antes de rechazar — "un
--     mixto siempre tiene salida". El presencial PURO (modalidad='presencial')
--     sigue rechazando al llenarse (no tiene canal online). Misma firma →
--     CREATE OR REPLACE (sin overload, R16).
--
-- (B · blindaje, E-GG-88/92) REVOKE EXECUTE ... FROM anon en las funciones de
--     eventos que NO deben ser anon-ejecutables: el default PUBLIC pre-0130
--     auto-otorga a anon y REVOKE FROM PUBLIC no lo saca. crear_webinar y
--     webinar_marcar_asistencia son staff-only (ya rebotan por is_staff, pero
--     defensa en profundidad); inscribir_a_webinar la usan el trigger
--     (SECURITY DEFINER) / la edge fn submit-formulario (service_role) / el
--     portal (authenticated) — nunca anon directo.

CREATE OR REPLACE FUNCTION public.inscribir_a_webinar(
  p_webinar_id uuid,
  p_email text,
  p_nombre text,
  p_telefono text DEFAULT NULL,
  p_submission_id uuid DEFAULT NULL,
  p_modalidad_preferida text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_webinar record;
  v_email_norm text;
  v_email_jwt text;
  v_administracion_id uuid;
  v_profile_id uuid;
  v_prospecto_id uuid;
  v_zoom_count integer;
  v_pres_count integer;
  v_canal text;
  v_inscripto_id uuid;
  v_token text;
  v_vence_at timestamptz;
  v_es_prospecto boolean;
  v_pref text;
  v_pres_disponible boolean;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_requerido' USING ERRCODE = '22023';
  END IF;
  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'nombre_requerido' USING ERRCODE = '22023';
  END IF;
  v_email_norm := lower(trim(p_email));

  IF auth.uid() IS NOT NULL AND NOT private.is_staff() THEN
    v_email_jwt := lower(trim(coalesce(
      (auth.jwt() ->> 'email'),
      (SELECT email FROM auth.users WHERE id = auth.uid())
    )));
    IF v_email_norm <> v_email_jwt THEN
      RAISE EXCEPTION 'no_access: solo podés inscribirte vos mismo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

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
      'modalidad', v_webinar.modalidad,
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

  -- ¿Hay lugar en la sala física?
  SELECT COUNT(*) INTO v_pres_count
    FROM public.webinar_inscriptos
   WHERE webinar_id = p_webinar_id AND canal = 'presencial';
  v_pres_disponible := (v_webinar.cupo_presencial IS NULL OR v_pres_count < v_webinar.cupo_presencial);

  v_pref := lower(nullif(trim(coalesce(p_modalidad_preferida, '')), ''));

  IF v_webinar.modalidad = 'presencial' THEN
    -- Presencial puro: sin canal online, se rechaza si no hay cupo.
    IF NOT v_pres_disponible THEN
      RAISE EXCEPTION 'webinar_sin_cupo_presencial' USING ERRCODE = '22023';
    END IF;
    v_canal := 'presencial';
  ELSIF v_webinar.modalidad = 'mixto' AND v_pref = 'presencial' AND v_pres_disponible THEN
    -- Mixto, eligió presencial y hay cupo.
    v_canal := 'presencial';
  ELSE
    -- Online (o mixto: eligió online / presencial sin cupo): Zoom FCFS → YouTube.
    SELECT COUNT(*) INTO v_zoom_count
      FROM public.webinar_inscriptos
     WHERE webinar_id = p_webinar_id AND canal = 'zoom';
    IF v_webinar.cupo_zoom IS NOT NULL AND v_webinar.zoom_join_url IS NOT NULL
       AND v_zoom_count < v_webinar.cupo_zoom THEN
      v_canal := 'zoom';
    ELSIF v_webinar.youtube_live_url IS NOT NULL THEN
      v_canal := 'youtube';
    ELSIF v_webinar.modalidad = 'mixto' AND v_pres_disponible THEN
      -- Mixto sin online disponible → presencial (si hay cupo).
      v_canal := 'presencial';
    ELSE
      RAISE EXCEPTION 'webinar_sin_canales_disponibles' USING ERRCODE = '22023';
    END IF;
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
    'modalidad', v_webinar.modalidad,
    'inscripto_id', v_inscripto_id, 'es_prospecto', v_es_prospecto,
    'prospecto_id', v_prospecto_id, 'administracion_id', v_administracion_id,
    'ya_inscripto', false
  );
END;
$function$;

-- (B) Blindaje: sacar el grant heredado de anon (E-GG-88/92).
REVOKE EXECUTE ON FUNCTION public.inscribir_a_webinar(uuid,text,text,text,uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crear_webinar(text,text,timestamptz,integer,integer,uuid,text,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.webinar_marcar_asistencia(uuid, boolean) FROM anon;

-- Smoke: 1 sola firma de inscribir_a_webinar + anon sin EXECUTE en las 3.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='inscribir_a_webinar';
  IF v_n <> 1 THEN RAISE EXCEPTION 'smoke 0292: overload inscribir_a_webinar (%)', v_n; END IF;
  IF has_function_privilege('anon', 'public.crear_webinar(text,text,timestamptz,integer,integer,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.webinar_marcar_asistencia(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.inscribir_a_webinar(uuid,text,text,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'smoke 0292: anon todavía puede ejecutar una función de eventos staff/interna';
  END IF;
  RAISE NOTICE 'smoke 0292 OK';
END $$;
