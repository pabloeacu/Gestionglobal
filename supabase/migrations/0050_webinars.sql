-- 0050_webinars.sql — Subsistema Webinars públicos (DGG-11 + DGG-15)
--
-- Webinars = sesiones públicas, gratuitas, para captación de prospectos.
-- Inscripción vía formulario tipo `evento` (público sin login). El inscripto
-- recibe magic-link a /webinar/:token. Plataforma video: Zoom (cupo) +
-- YouTube Live (fallback ilimitado) · Webex parked (DGG-19).
--
-- Reglas:
--   - Single-tenant. Eje secundario = administracion (cuando el inscripto
--     es cliente existente). Prospecto liviano si NO es cliente.
--   - RLS estricta. Lookup por token vía edge function service-role.
--   - RPC SD con search_path fijo (regla 5).
--   - El email del prospecto es identidad única (UNIQUE).
--   - Asignación de canal FCFS al inscribirse: zoom < cupo → zoom, sino
--     youtube si hay URL configurada, sino raise.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) Tabla prospectos (entidad liviana, separada de administraciones)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prospectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  email text NOT NULL UNIQUE,
  telefono text,
  origen text NOT NULL DEFAULT 'webinar',
  observaciones text,
  -- Vínculos a conversión
  convertido_a_administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  convertido_at timestamptz,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospectos_convertido
  ON public.prospectos(convertido_a_administracion_id)
  WHERE convertido_a_administracion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospectos_creados
  ON public.prospectos(created_at DESC);

COMMENT ON TABLE public.prospectos IS
  'DGG-11: leads de webinars/captación. Liviano. Convertible a administración con un click.';

-- ────────────────────────────────────────────────────────────────
-- 2) Tabla webinars
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webinars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descripcion text,
  fecha_hora timestamptz NOT NULL,
  duracion_min integer NOT NULL DEFAULT 60 CHECK (duracion_min > 0 AND duracion_min <= 600),

  -- Vínculo opcional al formulario que inscribe (un webinar puede no tener
  -- formulario público si es por invitación manual)
  formulario_id uuid REFERENCES public.formularios(id) ON DELETE SET NULL,

  -- Estado
  status text NOT NULL DEFAULT 'programado'
    CHECK (status IN ('programado','en_curso','finalizado','cancelado')),
  iniciado_at timestamptz,
  finalizado_at timestamptz,

  -- Plataforma principal (Zoom o Webex parked)
  plataforma text NOT NULL DEFAULT 'zoom' CHECK (plataforma IN ('zoom','webex')),

  -- Datos Zoom (opcional · si null y youtube_live_url no null, solo va YouTube)
  cupo_zoom integer CHECK (cupo_zoom IS NULL OR cupo_zoom > 0),
  zoom_meeting_id bigint,
  zoom_join_url text,
  zoom_start_url text,
  zoom_password text,
  zoom_meeting_number text,

  -- Datos Webex (parked, scaffold para futuro upgrade)
  webex_meeting_id text,
  webex_join_url text,
  webex_password text,

  -- YouTube Live (fallback público ilimitado)
  youtube_live_url text,

  -- Grabación post-evento (URL externa)
  grabacion_url text,

  -- Auditoría
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webinars_zoom_meeting_id
  ON public.webinars(zoom_meeting_id) WHERE zoom_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webinars_fecha_hora
  ON public.webinars(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_webinars_status
  ON public.webinars(status) WHERE status IN ('programado','en_curso');
CREATE INDEX IF NOT EXISTS idx_webinars_formulario
  ON public.webinars(formulario_id) WHERE formulario_id IS NOT NULL;

COMMENT ON TABLE public.webinars IS
  'DGG-11/15: webinars públicos con dual canal Zoom (cupo) + YouTube Live (fallback ilimitado).';
COMMENT ON COLUMN public.webinars.cupo_zoom IS
  'Máximo de inscriptos zoom (FCFS). Free plan = 100. NULL = no usar Zoom.';
COMMENT ON COLUMN public.webinars.youtube_live_url IS
  'URL pública YouTube Live. Si está seteada, inscriptos desbordados de Zoom van acá.';

-- ────────────────────────────────────────────────────────────────
-- 3) Tabla webinar_inscriptos
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webinar_inscriptos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,

  -- Identidad: O administracion_id (cliente existente) O prospecto_id (lead)
  -- Profile_id opcional (si el cliente además tiene login en la plataforma)
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Snapshot de datos en el momento de la inscripción (sobreviven a borrados)
  email_snapshot text NOT NULL,
  nombre_snapshot text NOT NULL,
  telefono_snapshot text,

  -- Canal asignado (FCFS al inscribirse)
  canal text NOT NULL CHECK (canal IN ('zoom','youtube')),

  -- Vínculo opcional al submission que originó la inscripción
  formulario_submission_id uuid REFERENCES public.formulario_submissions(id) ON DELETE SET NULL,

  -- Asistencia
  asistio boolean NOT NULL DEFAULT false,
  joined_at timestamptz,
  left_at timestamptz,
  tiempo_conectado_seg integer NOT NULL DEFAULT 0,

  -- Recordatorios enviados (idempotencia)
  bienvenida_email_enviada_at timestamptz,
  recordatorio_24h_enviado_at timestamptz,
  recordatorio_1h_enviado_at timestamptz,
  gracias_email_enviado_at timestamptz,

  inscripto_at timestamptz NOT NULL DEFAULT now(),

  -- Exactamente uno de (administracion_id, prospecto_id) debe ser NOT NULL
  CONSTRAINT webinar_inscriptos_identidad_xor CHECK (
    (administracion_id IS NOT NULL AND prospecto_id IS NULL)
    OR
    (administracion_id IS NULL AND prospecto_id IS NOT NULL)
  ),
  -- Un email único por webinar (idempotencia de inscripción)
  CONSTRAINT webinar_inscriptos_unique_email UNIQUE (webinar_id, email_snapshot)
);
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_webinar
  ON public.webinar_inscriptos(webinar_id, canal);
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_admin
  ON public.webinar_inscriptos(administracion_id) WHERE administracion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_prospecto
  ON public.webinar_inscriptos(prospecto_id) WHERE prospecto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_submission
  ON public.webinar_inscriptos(formulario_submission_id) WHERE formulario_submission_id IS NOT NULL;

COMMENT ON TABLE public.webinar_inscriptos IS
  'DGG-11: un inscripto por webinar (cliente XOR prospecto). Email único por webinar.';

-- ────────────────────────────────────────────────────────────────
-- 4) Tabla webinar_acceso_tokens (magic-link público)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webinar_acceso_tokens (
  token text PRIMARY KEY,
  webinar_inscripto_id uuid NOT NULL REFERENCES public.webinar_inscriptos(id) ON DELETE CASCADE,
  vence_at timestamptz NOT NULL,
  primera_visita_at timestamptz,
  ultima_visita_at timestamptz,
  total_visitas integer NOT NULL DEFAULT 0,
  ip_ultima text,
  user_agent_ultima text,
  revocado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webinar_acceso_tokens_inscripto
  ON public.webinar_acceso_tokens(webinar_inscripto_id);
CREATE INDEX IF NOT EXISTS idx_webinar_acceso_tokens_vivos
  ON public.webinar_acceso_tokens(vence_at) WHERE revocado_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- 5) Tabla webinar_zoom_eventos (log inmutable de joins/leaves)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webinar_zoom_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  webinar_inscripto_id uuid REFERENCES public.webinar_inscriptos(id) ON DELETE SET NULL,
  evento text NOT NULL CHECK (evento IN ('join','leave','start','end')),
  ocurrido_at timestamptz NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webinar_zoom_eventos_webinar
  ON public.webinar_zoom_eventos(webinar_id, ocurrido_at);

-- ────────────────────────────────────────────────────────────────
-- 6) RLS
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.prospectos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinars                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_inscriptos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_acceso_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_zoom_eventos     ENABLE ROW LEVEL SECURITY;

-- prospectos: sólo staff
DROP POLICY IF EXISTS prospectos_staff_all ON public.prospectos;
CREATE POLICY prospectos_staff_all ON public.prospectos
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- webinars: staff full · authenticated read (para el portal alumno/cliente vea sus inscripciones)
DROP POLICY IF EXISTS webinars_staff_all ON public.webinars;
CREATE POLICY webinars_staff_all ON public.webinars
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS webinars_authenticated_select ON public.webinars;
CREATE POLICY webinars_authenticated_select ON public.webinars
  FOR SELECT TO authenticated
  USING (true);

-- webinar_inscriptos: staff full · administrador ve los suyos (vinculados a su administracion)
DROP POLICY IF EXISTS webinar_inscriptos_staff_all ON public.webinar_inscriptos;
CREATE POLICY webinar_inscriptos_staff_all ON public.webinar_inscriptos
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS webinar_inscriptos_admin_select ON public.webinar_inscriptos;
CREATE POLICY webinar_inscriptos_admin_select ON public.webinar_inscriptos
  FOR SELECT TO authenticated
  USING (
    administracion_id IS NOT NULL
    AND administracion_id IN (
      SELECT administracion_id FROM public.profiles
      WHERE id = auth.uid() AND administracion_id IS NOT NULL
    )
  );

-- webinar_acceso_tokens: sólo staff (la consulta pública por token la hace edge fn con service_role)
DROP POLICY IF EXISTS webinar_acceso_tokens_staff_all ON public.webinar_acceso_tokens;
CREATE POLICY webinar_acceso_tokens_staff_all ON public.webinar_acceso_tokens
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- webinar_zoom_eventos: sólo staff (log de auditoría)
DROP POLICY IF EXISTS webinar_zoom_eventos_staff_select ON public.webinar_zoom_eventos;
CREATE POLICY webinar_zoom_eventos_staff_select ON public.webinar_zoom_eventos
  FOR SELECT TO authenticated USING (private.is_staff());

-- ────────────────────────────────────────────────────────────────
-- 7) RPC crear_webinar (staff)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crear_webinar(
  p_titulo text,
  p_descripcion text,
  p_fecha_hora timestamptz,
  p_duracion_min integer DEFAULT 60,
  p_cupo_zoom integer DEFAULT 100,
  p_formulario_id uuid DEFAULT NULL,
  p_youtube_live_url text DEFAULT NULL,
  p_plataforma text DEFAULT 'zoom'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_titulo IS NULL OR length(trim(p_titulo)) = 0 THEN
    RAISE EXCEPTION 'titulo requerido' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_hora IS NULL THEN
    RAISE EXCEPTION 'fecha_hora requerida' USING ERRCODE = '22023';
  END IF;
  IF p_plataforma NOT IN ('zoom','webex') THEN
    RAISE EXCEPTION 'plataforma inválida' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.webinars (
    titulo, descripcion, fecha_hora, duracion_min,
    cupo_zoom, formulario_id, youtube_live_url, plataforma,
    creado_por
  ) VALUES (
    trim(p_titulo), p_descripcion, p_fecha_hora, COALESCE(p_duracion_min, 60),
    p_cupo_zoom, p_formulario_id, p_youtube_live_url, p_plataforma,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_webinar(text, text, timestamptz, integer, integer, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_webinar(text, text, timestamptz, integer, integer, uuid, text, text)
  TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 8) RPC webinar_set_zoom (staff)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.webinar_set_zoom(
  p_webinar_id uuid,
  p_meeting_id bigint,
  p_join_url text,
  p_start_url text,
  p_password text,
  p_meeting_number text DEFAULT NULL,
  p_duracion_min integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.webinars
     SET zoom_meeting_id = p_meeting_id,
         zoom_join_url = p_join_url,
         zoom_start_url = p_start_url,
         zoom_password = p_password,
         zoom_meeting_number = COALESCE(p_meeting_number, zoom_meeting_number),
         duracion_min = COALESCE(p_duracion_min, duracion_min),
         updated_at = now()
   WHERE id = p_webinar_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'webinar_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webinar_set_zoom(uuid, bigint, text, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webinar_set_zoom(uuid, bigint, text, text, text, text, integer)
  TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 9) RPC inscribir_a_webinar (público vía edge fn O trigger del submission)
-- ────────────────────────────────────────────────────────────────
-- Acepta llamadas desde:
--   - Trigger AFTER INSERT en formulario_submissions (NEW.administracion_id puede llegar resuelto)
--   - Edge function service-role (anon-facing) cuando se inscriben directo
-- Devuelve JSON con {token, canal, webinar_id, es_prospecto, prospecto_id, administracion_id}

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
  -- Normalizar
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_requerido' USING ERRCODE = '22023';
  END IF;
  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'nombre_requerido' USING ERRCODE = '22023';
  END IF;
  v_email_norm := lower(trim(p_email));

  -- Obtener webinar
  SELECT * INTO v_webinar FROM public.webinars WHERE id = p_webinar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webinar_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_webinar.status = 'cancelado' THEN
    RAISE EXCEPTION 'webinar_cancelado' USING ERRCODE = '22023';
  END IF;
  -- Inscripción abierta hasta fecha_hora + duracion (durante el evento sí, después no)
  IF now() > (v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval) THEN
    RAISE EXCEPTION 'inscripcion_cerrada' USING ERRCODE = '22023';
  END IF;

  -- Si ya está inscripto con ese email, devolver su token vigente (idempotente)
  SELECT wi.id INTO v_inscripto_id
    FROM public.webinar_inscriptos wi
   WHERE wi.webinar_id = p_webinar_id AND wi.email_snapshot = v_email_norm;
  IF FOUND THEN
    SELECT token INTO v_token
      FROM public.webinar_acceso_tokens
     WHERE webinar_inscripto_id = v_inscripto_id
       AND revocado_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_token IS NULL THEN
      v_token := encode(gen_random_bytes(32), 'hex');
      v_vence_at := v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval + interval '30 days';
      INSERT INTO public.webinar_acceso_tokens(token, webinar_inscripto_id, vence_at)
        VALUES (v_token, v_inscripto_id, v_vence_at);
    END IF;
    SELECT canal, administracion_id, prospecto_id
      INTO v_canal, v_administracion_id, v_prospecto_id
      FROM public.webinar_inscriptos WHERE id = v_inscripto_id;
    RETURN jsonb_build_object(
      'token', v_token,
      'canal', v_canal,
      'webinar_id', p_webinar_id,
      'inscripto_id', v_inscripto_id,
      'es_prospecto', v_prospecto_id IS NOT NULL,
      'prospecto_id', v_prospecto_id,
      'administracion_id', v_administracion_id,
      'ya_inscripto', true
    );
  END IF;

  -- Detectar cliente existente: administraciones.email match
  SELECT id INTO v_administracion_id
    FROM public.administraciones
   WHERE lower(trim(email)) = v_email_norm
   LIMIT 1;
  -- Profile opcional (cliente que tiene login)
  IF v_administracion_id IS NOT NULL THEN
    SELECT id INTO v_profile_id
      FROM public.profiles
     WHERE lower(trim(email)) = v_email_norm AND administracion_id = v_administracion_id
     LIMIT 1;
  END IF;

  v_es_prospecto := v_administracion_id IS NULL;

  -- Si es prospecto: upsert
  IF v_es_prospecto THEN
    INSERT INTO public.prospectos(nombre, email, telefono, origen)
    VALUES (trim(p_nombre), v_email_norm, p_telefono, 'webinar')
    ON CONFLICT (email) DO UPDATE
      SET nombre = COALESCE(EXCLUDED.nombre, public.prospectos.nombre),
          telefono = COALESCE(EXCLUDED.telefono, public.prospectos.telefono),
          updated_at = now()
    RETURNING id INTO v_prospecto_id;
  END IF;

  -- Asignar canal FCFS
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

  -- Crear inscripto
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

  -- Generar token de acceso
  v_token := encode(gen_random_bytes(32), 'hex');
  v_vence_at := v_webinar.fecha_hora + (v_webinar.duracion_min || ' minutes')::interval + interval '30 days';
  INSERT INTO public.webinar_acceso_tokens(token, webinar_inscripto_id, vence_at)
    VALUES (v_token, v_inscripto_id, v_vence_at);

  RETURN jsonb_build_object(
    'token', v_token,
    'canal', v_canal,
    'webinar_id', p_webinar_id,
    'inscripto_id', v_inscripto_id,
    'es_prospecto', v_es_prospecto,
    'prospecto_id', v_prospecto_id,
    'administracion_id', v_administracion_id,
    'ya_inscripto', false
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscribir_a_webinar(uuid, text, text, text, uuid) FROM PUBLIC, anon;
-- service_role usa esta RPC desde edge fn / trigger SECURITY DEFINER
GRANT EXECUTE ON FUNCTION public.inscribir_a_webinar(uuid, text, text, text, uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────
-- 10) RPC webinar_zoom_evento (service-role para webhook)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.webinar_zoom_evento(
  p_zoom_meeting_id bigint,
  p_inscripto_id uuid,
  p_evento text,
  p_ocurrido_at timestamptz,
  p_payload jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_webinar_id uuid;
  v_inscripto record;
  v_duracion integer;
BEGIN
  IF p_evento NOT IN ('join','leave','start','end') THEN
    RAISE EXCEPTION 'evento_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_webinar_id
    FROM public.webinars
   WHERE zoom_meeting_id = p_zoom_meeting_id;
  IF NOT FOUND THEN
    -- Meeting no es de un webinar (puede ser de un curso) → ignorar silenciosamente
    RETURN;
  END IF;

  INSERT INTO public.webinar_zoom_eventos(
    webinar_id, webinar_inscripto_id, evento, ocurrido_at, payload
  ) VALUES (
    v_webinar_id, p_inscripto_id, p_evento, p_ocurrido_at, p_payload
  );

  IF p_evento = 'start' THEN
    UPDATE public.webinars
       SET status = 'en_curso', iniciado_at = COALESCE(iniciado_at, p_ocurrido_at), updated_at = now()
     WHERE id = v_webinar_id;
    RETURN;
  END IF;

  IF p_evento = 'end' THEN
    UPDATE public.webinars
       SET status = 'finalizado', finalizado_at = COALESCE(finalizado_at, p_ocurrido_at), updated_at = now()
     WHERE id = v_webinar_id;
    RETURN;
  END IF;

  -- join/leave: acumular tiempo
  IF p_inscripto_id IS NULL THEN
    RETURN; -- evento sin inscripto identificado (host) → solo log
  END IF;

  SELECT * INTO v_inscripto
    FROM public.webinar_inscriptos
   WHERE id = p_inscripto_id AND webinar_id = v_webinar_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_evento = 'join' THEN
    UPDATE public.webinar_inscriptos
       SET joined_at = COALESCE(v_inscripto.joined_at, p_ocurrido_at),
           asistio = true
     WHERE id = p_inscripto_id;
  ELSE -- leave
    v_duracion := GREATEST(0, EXTRACT(EPOCH FROM (p_ocurrido_at - COALESCE(v_inscripto.joined_at, p_ocurrido_at)))::int);
    UPDATE public.webinar_inscriptos
       SET left_at = p_ocurrido_at,
           tiempo_conectado_seg = v_inscripto.tiempo_conectado_seg + v_duracion
     WHERE id = p_inscripto_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webinar_zoom_evento(bigint, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webinar_zoom_evento(bigint, uuid, text, timestamptz, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────────
-- 11) RPC convertir_prospecto_a_cliente (staff)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.convertir_prospecto_a_cliente(
  p_prospecto_id uuid,
  p_administracion_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.prospectos
     SET convertido_a_administracion_id = p_administracion_id,
         convertido_at = now(),
         updated_at = now()
   WHERE id = p_prospecto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prospecto_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Relinkar todas las inscripciones del prospecto a la administración
  UPDATE public.webinar_inscriptos
     SET administracion_id = p_administracion_id,
         prospecto_id = NULL
   WHERE prospecto_id = p_prospecto_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.convertir_prospecto_a_cliente(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convertir_prospecto_a_cliente(uuid, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 12) RPC list_webinar_kpis (staff · KPIs para listado)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_webinar_kpis()
RETURNS TABLE (
  proximos integer,
  en_vivo integer,
  finalizados integer,
  total_inscriptos integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT COUNT(*)::int FROM public.webinars WHERE status = 'programado' AND fecha_hora > now()),
    (SELECT COUNT(*)::int FROM public.webinars WHERE status = 'en_curso'),
    (SELECT COUNT(*)::int FROM public.webinars WHERE status = 'finalizado'),
    (SELECT COUNT(*)::int FROM public.webinar_inscriptos)
  WHERE private.is_staff();
$$;
REVOKE EXECUTE ON FUNCTION public.list_webinar_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_webinar_kpis() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 13) Vincular formularios a webinars (FK opcional)
-- ────────────────────────────────────────────────────────────────
-- En formularios categoria='evento', el campo `webinar_id` indica a qué
-- webinar se inscribe automáticamente la submission.

ALTER TABLE public.formularios
  ADD COLUMN IF NOT EXISTS webinar_id uuid REFERENCES public.webinars(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_formularios_webinar
  ON public.formularios(webinar_id) WHERE webinar_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 14) Trigger AFTER INSERT en formulario_submissions
-- ────────────────────────────────────────────────────────────────
-- Si el formulario es categoria='evento' y tiene webinar_id seteado →
-- llamar inscribir_a_webinar(...) usando los datos del submission.

CREATE OR REPLACE FUNCTION public.inscribir_webinar_desde_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_categoria text;
  v_webinar_id uuid;
  v_resultado jsonb;
BEGIN
  SELECT categoria, webinar_id INTO v_categoria, v_webinar_id
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  IF v_categoria <> 'evento' OR v_webinar_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.email_contacto IS NULL OR NEW.nombre_contacto IS NULL THEN
    RETURN NEW; -- no podemos inscribir sin email+nombre
  END IF;

  BEGIN
    v_resultado := public.inscribir_a_webinar(
      v_webinar_id,
      NEW.email_contacto,
      NEW.nombre_contacto,
      NEW.telefono_contacto,
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    -- No bloquear la submission si la inscripción falla (cupo o webinar cerrado)
    RAISE WARNING 'inscribir_webinar_desde_submission: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscribir_webinar_desde_submission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_subm_inscribir_webinar ON public.formulario_submissions;
CREATE TRIGGER trg_subm_inscribir_webinar
  AFTER INSERT ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.inscribir_webinar_desde_submission();

-- ────────────────────────────────────────────────────────────────
-- 15) updated_at triggers
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_webinars_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_webinars_updated_at ON public.webinars;
CREATE TRIGGER trg_webinars_updated_at
  BEFORE UPDATE ON public.webinars
  FOR EACH ROW EXECUTE FUNCTION public.tg_webinars_updated_at();

DROP TRIGGER IF EXISTS trg_prospectos_updated_at ON public.prospectos;
CREATE TRIGGER trg_prospectos_updated_at
  BEFORE UPDATE ON public.prospectos
  FOR EACH ROW EXECUTE FUNCTION public.tg_webinars_updated_at();

COMMIT;
