-- 0286 · Eventos: ampliar "webinars" a online / presencial / mixto (+ tipo,
-- ubicación, cupo presencial, arancel informativo). Pedido de Pablo.
--
-- TODO ADITIVO → los webinars existentes quedan modalidad='online' y se
-- comportan idénticos (el branch online es la lógica actual, intacta).
-- Nombre de tabla/rutas se mantiene (`webinars`) para no romper nada; el
-- relabel a "Eventos" es sólo de UI.
--
-- R16: `inscribir_a_webinar` gana un parámetro → DROP de la firma vieja +
--      CREATE de la nueva (con DEFAULT) para NO dejar overload ambiguo.

-- ---------------------------------------------------------------------------
-- 1) Nuevas columnas del evento
-- ---------------------------------------------------------------------------
ALTER TABLE public.webinars
  ADD COLUMN IF NOT EXISTS modalidad text NOT NULL DEFAULT 'online'
    CHECK (modalidad IN ('online','presencial','mixto')),
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'webinar'
    CHECK (tipo IN ('webinar','charla','taller','jornada','curso','podcast','otro')),
  -- Ubicación (si presencial/mixto)
  ADD COLUMN IF NOT EXISTS ubicacion_lugar text,
  ADD COLUMN IF NOT EXISTS ubicacion_direccion text,
  ADD COLUMN IF NOT EXISTS ubicacion_localidad text,
  ADD COLUMN IF NOT EXISTS ubicacion_mapa_url text,
  ADD COLUMN IF NOT EXISTS ubicacion_instrucciones text,
  ADD COLUMN IF NOT EXISTS cupo_presencial integer
    CHECK (cupo_presencial IS NULL OR cupo_presencial > 0),
  -- Arancel (SÓLO informativo — no hay cobranza online)
  ADD COLUMN IF NOT EXISTS es_arancelado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS arancel_monto numeric(12,2)
    CHECK (arancel_monto IS NULL OR arancel_monto >= 0),
  ADD COLUMN IF NOT EXISTS arancel_nota text;

COMMENT ON COLUMN public.webinars.modalidad IS 'online (Zoom/YouTube) · presencial (lugar físico) · mixto (ambos, el inscripto elige)';
COMMENT ON COLUMN public.webinars.tipo IS 'Etiqueta del evento: webinar/charla/taller/jornada/curso/podcast/otro (informativo).';
COMMENT ON COLUMN public.webinars.cupo_presencial IS 'Cupo de la sala física (independiente de cupo_zoom). NULL = sin límite.';
COMMENT ON COLUMN public.webinars.es_arancelado IS 'Informativo: el evento tiene costo. NO se cobra online (dato del evento).';

CREATE INDEX IF NOT EXISTS idx_webinars_modalidad
  ON public.webinars(modalidad) WHERE modalidad <> 'online';

-- ---------------------------------------------------------------------------
-- 2) El inscripto ahora puede tener canal 'presencial'
-- ---------------------------------------------------------------------------
ALTER TABLE public.webinar_inscriptos
  DROP CONSTRAINT IF EXISTS webinar_inscriptos_canal_check;
ALTER TABLE public.webinar_inscriptos
  ADD CONSTRAINT webinar_inscriptos_canal_check
    CHECK (canal IN ('zoom','youtube','presencial'));

-- ---------------------------------------------------------------------------
-- 3) Inscripción: branch por modalidad. Online = lógica actual intacta.
--    R16: DROP firma vieja + CREATE nueva (con p_modalidad_preferida).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.inscribir_a_webinar(uuid, text, text, text, uuid);

CREATE FUNCTION public.inscribir_a_webinar(
  p_webinar_id uuid,
  p_email text,
  p_nombre text,
  p_telefono text DEFAULT NULL,
  p_submission_id uuid DEFAULT NULL,
  p_modalidad_preferida text DEFAULT NULL   -- 'presencial' | 'online' (sólo relevante en mixto)
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
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_requerido' USING ERRCODE = '22023';
  END IF;
  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'nombre_requerido' USING ERRCODE = '22023';
  END IF;
  v_email_norm := lower(trim(p_email));

  -- AUDIT-010: tenancy guard. Si el caller es authenticated (y NO staff),
  -- el email debe ser el suyo.
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

  -- Idempotencia: ya inscripto con ese email → devolver su token vigente.
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

  -- ¿Es cliente existente (por email) o prospecto nuevo?
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

  -- ---- NUEVO: asignación de canal según modalidad --------------------------
  v_pref := lower(nullif(trim(coalesce(p_modalidad_preferida, '')), ''));

  IF v_webinar.modalidad = 'presencial' THEN
    v_canal := 'presencial';
  ELSIF v_webinar.modalidad = 'mixto' AND v_pref = 'presencial' THEN
    v_canal := 'presencial';
  ELSE
    -- online (o mixto que eligió online / sin preferencia): Zoom FCFS → YouTube.
    SELECT COUNT(*) INTO v_zoom_count
      FROM public.webinar_inscriptos
     WHERE webinar_id = p_webinar_id AND canal = 'zoom';
    IF v_webinar.cupo_zoom IS NOT NULL AND v_webinar.zoom_join_url IS NOT NULL
       AND v_zoom_count < v_webinar.cupo_zoom THEN
      v_canal := 'zoom';
    ELSIF v_webinar.youtube_live_url IS NOT NULL THEN
      v_canal := 'youtube';
    ELSIF v_webinar.modalidad = 'mixto' THEN
      -- Mixto sin online disponible → cae a presencial (siempre hay sala física).
      v_canal := 'presencial';
    ELSE
      RAISE EXCEPTION 'webinar_sin_canales_disponibles' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Cupo de la sala física (si aplica).
  IF v_canal = 'presencial' THEN
    SELECT COUNT(*) INTO v_pres_count
      FROM public.webinar_inscriptos
     WHERE webinar_id = p_webinar_id AND canal = 'presencial';
    IF v_webinar.cupo_presencial IS NOT NULL AND v_pres_count >= v_webinar.cupo_presencial THEN
      RAISE EXCEPTION 'webinar_sin_cupo_presencial' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- --------------------------------------------------------------------------

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

-- Grants IDÉNTICOS a la firma vieja (authenticated + service_role; NO anon:
-- el flujo público entra por la edge fn submit-formulario / trigger, service_role).
REVOKE ALL ON FUNCTION public.inscribir_a_webinar(uuid,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inscribir_a_webinar(uuid,text,text,text,uuid,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Smoke (R16): una sola firma de inscribir_a_webinar (sin overload).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='inscribir_a_webinar';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'smoke 0286: se esperaba 1 firma de inscribir_a_webinar, hay %', v_n;
  END IF;
  RAISE NOTICE 'smoke 0286 OK: inscribir_a_webinar única, modalidad/tipo/ubicación/arancel agregados';
END $$;
