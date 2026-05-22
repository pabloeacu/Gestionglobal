-- 0047_campus_zoom.sql — Campus Fase 3 · Integración Zoom
--
-- DGG-14: Zoom Pro + Meeting SDK (Web) embebido + S2S OAuth.
-- Extiende `curso_encuentros` con metadata de la reunión Zoom y
-- `curso_encuentro_asistencias` con timestamps de join/leave para
-- registrar asistencia automática vía webhook.
--
-- Reglas:
--   - Single-tenant. Sin empresa_id. Eje = administracion via matricula.
--   - RLS heredada de las políticas ya existentes en 0045.
--   - RPC SD con search_path fijo (regla 5).
--   - El edge function zoom-webhook llama curso_encuentro_zoom_evento
--     usando service-role (bypass RLS) para registrar join/leave.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) Metadata Zoom en curso_encuentros
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.curso_encuentros
  ADD COLUMN IF NOT EXISTS zoom_meeting_id bigint,
  ADD COLUMN IF NOT EXISTS zoom_join_url   text,
  ADD COLUMN IF NOT EXISTS zoom_start_url  text,
  ADD COLUMN IF NOT EXISTS zoom_password   text,
  ADD COLUMN IF NOT EXISTS duracion_min    integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS zoom_status     text    NOT NULL DEFAULT 'programado',
  ADD COLUMN IF NOT EXISTS iniciado_at     timestamptz,
  ADD COLUMN IF NOT EXISTS finalizado_at   timestamptz,
  ADD COLUMN IF NOT EXISTS grabacion_url   text,
  ADD COLUMN IF NOT EXISTS grabacion_play_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curso_encuentros_zoom_status_chk'
  ) THEN
    ALTER TABLE public.curso_encuentros
      ADD CONSTRAINT curso_encuentros_zoom_status_chk
      CHECK (zoom_status IN ('programado','en_curso','finalizado','cancelado'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_curso_encuentros_zoom_meeting_id
  ON public.curso_encuentros(zoom_meeting_id)
  WHERE zoom_meeting_id IS NOT NULL;

COMMENT ON COLUMN public.curso_encuentros.zoom_meeting_id IS
  'DGG-14: numeric meeting ID de Zoom (devuelto por POST /users/{user}/meetings).';
COMMENT ON COLUMN public.curso_encuentros.zoom_start_url IS
  'URL host one-click. Sensible (incluye ZAK). Solo visible para docente/gerente.';
COMMENT ON COLUMN public.curso_encuentros.zoom_join_url IS
  'URL pública para join nativo (fallback si el embed falla).';

-- ────────────────────────────────────────────────────────────────
-- 2) Asistencia automática + umbral configurable
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.cursos
  ADD COLUMN IF NOT EXISTS presencia_minima_pct integer NOT NULL DEFAULT 50;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cursos_presencia_minima_pct_chk'
  ) THEN
    ALTER TABLE public.cursos
      ADD CONSTRAINT cursos_presencia_minima_pct_chk
      CHECK (presencia_minima_pct BETWEEN 0 AND 100);
  END IF;
END$$;

COMMENT ON COLUMN public.cursos.presencia_minima_pct IS
  'DGG-14: % de la duración total del encuentro requerido para marcar presente automático (default 50).';

ALTER TABLE public.curso_encuentro_asistencias
  ADD COLUMN IF NOT EXISTS unido_at            timestamptz,
  ADD COLUMN IF NOT EXISTS salido_at           timestamptz,
  ADD COLUMN IF NOT EXISTS tiempo_conectado_seg integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuente              text    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS umbral_cumplido     boolean NOT NULL DEFAULT false,
  -- presente queda como source-of-truth final (manual override > auto)
  ADD COLUMN IF NOT EXISTS auto_presente       boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curso_encuentro_asistencias_fuente_chk'
  ) THEN
    ALTER TABLE public.curso_encuentro_asistencias
      ADD CONSTRAINT curso_encuentro_asistencias_fuente_chk
      CHECK (fuente IN ('manual','zoom_auto','mixto'));
  END IF;
END$$;

-- Log granular de join/leave (un alumno puede entrar/salir varias veces).
CREATE TABLE IF NOT EXISTS public.curso_encuentro_zoom_eventos (
  id            uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  encuentro_id  uuid NOT NULL REFERENCES public.curso_encuentros(id) ON DELETE CASCADE,
  matricula_id  uuid NOT NULL REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  evento        text NOT NULL CHECK (evento IN ('join','leave')),
  ocurrido_at   timestamptz NOT NULL,
  raw_payload   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_eventos_encuentro
  ON public.curso_encuentro_zoom_eventos(encuentro_id);
CREATE INDEX IF NOT EXISTS idx_zoom_eventos_matricula
  ON public.curso_encuentro_zoom_eventos(matricula_id);

ALTER TABLE public.curso_encuentro_zoom_eventos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='curso_encuentro_zoom_eventos'
                   AND policyname='zoom_eventos_select_staff_or_owner') THEN
    CREATE POLICY zoom_eventos_select_staff_or_owner
      ON public.curso_encuentro_zoom_eventos FOR SELECT TO authenticated
      USING (
        private.is_staff()
        OR EXISTS (
          SELECT 1 FROM public.curso_matriculas m
          WHERE m.id = curso_encuentro_zoom_eventos.matricula_id
            AND m.profile_id = auth.uid()
        )
      );
  END IF;
END$$;

COMMENT ON TABLE public.curso_encuentro_zoom_eventos IS
  'DGG-14: log inmutable de eventos join/leave de Zoom por participante (vía webhook).';

-- ────────────────────────────────────────────────────────────────
-- 3) RPC: setear metadata Zoom en un encuentro (llamado por edge fn)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.curso_encuentro_set_zoom(
  p_encuentro_id  uuid,
  p_meeting_id    bigint,
  p_join_url      text,
  p_start_url     text,
  p_password      text,
  p_duracion_min  integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden: solo staff puede asignar la reunión Zoom';
  END IF;

  UPDATE public.curso_encuentros
     SET zoom_meeting_id = p_meeting_id,
         zoom_join_url   = p_join_url,
         zoom_start_url  = p_start_url,
         zoom_password   = p_password,
         duracion_min    = COALESCE(p_duracion_min, duracion_min),
         zoom_status     = 'programado'
   WHERE id = p_encuentro_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_encuentro_set_zoom(uuid,bigint,text,text,text,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_encuentro_set_zoom(uuid,bigint,text,text,text,integer)
  TO authenticated;

COMMENT ON FUNCTION public.curso_encuentro_set_zoom(uuid,bigint,text,text,text,integer) IS
  'DGG-14: staff guarda la metadata de la reunión Zoom creada vía edge fn zoom-meeting-create.';

-- ────────────────────────────────────────────────────────────────
-- 4) RPC: registrar evento de Zoom (llamado por edge fn webhook con service-role)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.curso_encuentro_zoom_evento(
  p_meeting_id  bigint,
  p_matricula_id uuid,
  p_evento      text,
  p_ocurrido_at timestamptz,
  p_payload     jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_encuentro_id    uuid;
  v_duracion_seg    int;
  v_pct_min         int;
  v_total_seg       int;
  v_log_id          uuid;
BEGIN
  -- Resolver encuentro por meeting_id
  SELECT id INTO v_encuentro_id
    FROM public.curso_encuentros
   WHERE zoom_meeting_id = p_meeting_id;

  IF v_encuentro_id IS NULL THEN
    RAISE EXCEPTION 'encuentro no encontrado para meeting_id=%', p_meeting_id;
  END IF;

  IF p_evento NOT IN ('join','leave') THEN
    RAISE EXCEPTION 'evento inválido: %', p_evento;
  END IF;

  -- Log inmutable
  INSERT INTO public.curso_encuentro_zoom_eventos(
    encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
  ) VALUES (
    v_encuentro_id, p_matricula_id, p_evento, p_ocurrido_at, p_payload
  ) RETURNING id INTO v_log_id;

  -- Upsert asistencia + recomputar tiempo_conectado_seg
  INSERT INTO public.curso_encuentro_asistencias(
    encuentro_id, matricula_id, presente, fuente, unido_at, marcada_at
  ) VALUES (
    v_encuentro_id, p_matricula_id,
    false,           -- presente final se recalcula abajo
    'zoom_auto',
    CASE WHEN p_evento='join' THEN p_ocurrido_at END,
    now()
  )
  ON CONFLICT (encuentro_id, matricula_id) DO UPDATE
     SET unido_at = COALESCE(curso_encuentro_asistencias.unido_at,
                             CASE WHEN p_evento='join' THEN p_ocurrido_at END),
         salido_at = CASE WHEN p_evento='leave' THEN p_ocurrido_at
                          ELSE curso_encuentro_asistencias.salido_at END,
         fuente = CASE WHEN curso_encuentro_asistencias.fuente='manual'
                       THEN 'mixto' ELSE 'zoom_auto' END;

  -- Recomputar tiempo_conectado_seg a partir del log (suma de pares join/leave)
  WITH eventos AS (
    SELECT evento, ocurrido_at,
           row_number() OVER (ORDER BY ocurrido_at) AS rn
      FROM public.curso_encuentro_zoom_eventos
     WHERE encuentro_id = v_encuentro_id AND matricula_id = p_matricula_id
  ),
  pares AS (
    SELECT j.ocurrido_at AS unido,
           (SELECT MIN(l.ocurrido_at)
              FROM eventos l
             WHERE l.evento='leave' AND l.rn > j.rn) AS salido
      FROM eventos j
     WHERE j.evento='join'
  ),
  total AS (
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(salido, now()) - unido))::int), 0) AS seg
      FROM pares
  )
  SELECT seg INTO v_total_seg FROM total;

  -- Umbral de presencia: pct del curso * duracion_min del encuentro
  SELECT c.presencia_minima_pct, e.duracion_min*60
    INTO v_pct_min, v_duracion_seg
    FROM public.curso_encuentros e
    JOIN public.cursos c ON c.id = e.curso_id
   WHERE e.id = v_encuentro_id;

  UPDATE public.curso_encuentro_asistencias
     SET tiempo_conectado_seg = v_total_seg,
         umbral_cumplido = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
         auto_presente = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
         -- Si la asistencia no fue forzada manualmente, presente = auto
         presente = CASE
           WHEN fuente='zoom_auto'
             THEN (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))
           ELSE presente
         END
   WHERE encuentro_id = v_encuentro_id AND matricula_id = p_matricula_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_encuentro_zoom_evento(bigint,uuid,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
-- service_role llama desde el edge function zoom-webhook.

COMMENT ON FUNCTION public.curso_encuentro_zoom_evento(bigint,uuid,text,timestamptz,jsonb) IS
  'DGG-14: registra join/leave de Zoom y recomputa tiempo conectado + umbral de presencia.';

-- ────────────────────────────────────────────────────────────────
-- 5) RPC: cambiar estado de la reunión (iniciado/finalizado)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.curso_encuentro_zoom_estado(
  p_meeting_id bigint,
  p_estado     text,
  p_ocurrido_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_estado NOT IN ('en_curso','finalizado','cancelado') THEN
    RAISE EXCEPTION 'estado inválido: %', p_estado;
  END IF;

  UPDATE public.curso_encuentros
     SET zoom_status   = p_estado,
         iniciado_at   = CASE WHEN p_estado='en_curso'
                              THEN COALESCE(iniciado_at, p_ocurrido_at)
                              ELSE iniciado_at END,
         finalizado_at = CASE WHEN p_estado='finalizado'
                              THEN COALESCE(finalizado_at, p_ocurrido_at)
                              ELSE finalizado_at END
   WHERE zoom_meeting_id = p_meeting_id
   RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_encuentro_zoom_estado(bigint,text,timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.curso_encuentro_zoom_estado(bigint,text,timestamptz) IS
  'DGG-14: edge fn zoom-webhook actualiza el estado del encuentro (meeting.started / ended).';

-- ────────────────────────────────────────────────────────────────
-- 6) RPC: guardar URL de grabación al recibir recording.completed
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.curso_encuentro_zoom_grabacion(
  p_meeting_id bigint,
  p_grabacion_url      text,
  p_grabacion_play_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.curso_encuentros
     SET grabacion_url      = p_grabacion_url,
         grabacion_play_url = COALESCE(p_grabacion_play_url, p_grabacion_url)
   WHERE zoom_meeting_id = p_meeting_id
   RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_encuentro_zoom_grabacion(bigint,text,text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.curso_encuentro_zoom_grabacion(bigint,text,text) IS
  'DGG-14: edge fn zoom-webhook guarda la URL de la grabación al recibir recording.completed.';

COMMIT;
