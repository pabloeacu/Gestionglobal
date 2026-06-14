-- ============================================================================
-- 0237_f11_fanout_asistencia_sesion.sql
-- F11 · Fan-out de asistencia para sesiones compartidas (DGG-79) — Fase 1
--
-- Cuando una persona se conecta a la sala de una SESIÓN compartida, su presente
-- debe registrarse en la asistencia de CADA curso enganchado a esa sesión donde
-- la persona esté matriculada. El webhook ya identifica al que entra por
-- customer_key = matricula_id (Meeting SDK). Resolvemos esa matrícula → profile
-- (persona = un perfil = un email de campus) y abanicamos a todas sus matrículas
-- activas en los cursos de la sesión.
--
-- Reutiliza EXACTAMENTE el cómputo de umbral del pipeline de un curso
-- (0047 · curso_encuentro_zoom_evento): tiempo conectado = suma de pares
-- join/leave del log; presente_auto = tiempo*100 >= duracion_seg * pct_curso.
-- La duración sale de la SESIÓN (una sola); el % de presencia es POR CURSO
-- (cada curso puede tener su propio cursos.presencia_minima_pct).
--
-- La cadena asistencia→trigger(0220)→matricula_condiciones→certificado funciona
-- POR CURSO sin tocarse: cada fila curso_encuentros mantiene su condicion_id.
--
-- R5: SECURITY DEFINER + search_path fijo. R16: nombres NUEVOS, sin overloads.
-- Llamadas por el edge fn zoom-webhook con service-role (R3).
-- ============================================================================

-- 1) FAN-OUT del evento join/leave a todos los cursos de la sesión ----------
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_evento(
  p_meeting_id   bigint,
  p_matricula_id uuid,        -- matrícula con la que se unió (customer_key del SDK)
  p_evento       text,
  p_ocurrido_at  timestamptz,
  p_payload      jsonb DEFAULT NULL
) RETURNS integer              -- cantidad de cursos donde se abanicó el presente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sesion_id    uuid;
  v_duracion_seg int;
  v_profile_id   uuid;
  v_pct_min      int;
  v_total_seg    int;
  v_fan          int := 0;
  r              record;
BEGIN
  IF p_evento NOT IN ('join','leave') THEN
    RAISE EXCEPTION 'evento inválido: %', p_evento;
  END IF;

  -- 1) Resolver la sesión compartida por meeting_id
  SELECT id, COALESCE(duracion_min,60) * 60
    INTO v_sesion_id, v_duracion_seg
    FROM public.encuentro_sesiones_compartidas
   WHERE zoom_meeting_id = p_meeting_id;
  IF v_sesion_id IS NULL THEN
    RAISE EXCEPTION 'sesión compartida no encontrada para meeting_id=%', p_meeting_id;
  END IF;

  -- 2) Resolver la persona (profile) desde la matrícula con la que entró
  SELECT profile_id INTO v_profile_id
    FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'matrícula % no encontrada (no se puede resolver persona)', p_matricula_id;
  END IF;

  -- 3) Abanicar: por cada curso enganchado a la sesión, la matrícula activa de
  --    esta persona en ese curso recibe el evento (log + asistencia + umbral).
  FOR r IN
    SELECT e.id AS encuentro_id, e.curso_id, m.id AS matricula_id
      FROM public.curso_encuentros e
      JOIN public.curso_matriculas m
        ON m.curso_id = e.curso_id
       AND m.profile_id = v_profile_id
       AND m.estado IN ('activa','completada')
     WHERE e.sesion_compartida_id = v_sesion_id
  LOOP
    -- 3a) log inmutable por encuentro (mismo formato que 0047)
    INSERT INTO public.curso_encuentro_zoom_eventos(
      encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
    ) VALUES (r.encuentro_id, r.matricula_id, p_evento, p_ocurrido_at, p_payload);

    -- 3b) upsert asistencia (idéntico a curso_encuentro_zoom_evento)
    INSERT INTO public.curso_encuentro_asistencias(
      encuentro_id, matricula_id, presente, fuente, unido_at, marcada_at
    ) VALUES (
      r.encuentro_id, r.matricula_id, false, 'zoom_auto',
      CASE WHEN p_evento='join' THEN p_ocurrido_at END, now()
    )
    ON CONFLICT (encuentro_id, matricula_id) DO UPDATE
       SET unido_at = COALESCE(curso_encuentro_asistencias.unido_at,
                               CASE WHEN p_evento='join' THEN p_ocurrido_at END),
           salido_at = CASE WHEN p_evento='leave' THEN p_ocurrido_at
                            ELSE curso_encuentro_asistencias.salido_at END,
           fuente = CASE WHEN curso_encuentro_asistencias.fuente='manual'
                         THEN 'mixto' ELSE 'zoom_auto' END;

    -- 3c) recomputar tiempo conectado desde el log de ESE encuentro/matrícula
    WITH eventos AS (
      SELECT evento, ocurrido_at,
             row_number() OVER (ORDER BY ocurrido_at) AS rn
        FROM public.curso_encuentro_zoom_eventos
       WHERE encuentro_id = r.encuentro_id AND matricula_id = r.matricula_id
    ),
    pares AS (
      SELECT j.ocurrido_at AS unido,
             (SELECT MIN(l.ocurrido_at)
                FROM eventos l
               WHERE l.evento='leave' AND l.rn > j.rn) AS salido
        FROM eventos j
       WHERE j.evento='join'
    )
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(salido, now()) - unido))::int), 0)
      INTO v_total_seg
      FROM pares;

    -- 3d) umbral con el % de presencia DE ESE CURSO (la duración es la de la sesión)
    SELECT c.presencia_minima_pct INTO v_pct_min
      FROM public.cursos c WHERE c.id = r.curso_id;

    UPDATE public.curso_encuentro_asistencias
       SET tiempo_conectado_seg = v_total_seg,
           umbral_cumplido = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           auto_presente   = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           presente = CASE
             WHEN fuente='zoom_auto'
               THEN (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))
             ELSE presente   -- respeta override manual del gerente (regla: manual > auto)
           END
     WHERE encuentro_id = r.encuentro_id AND matricula_id = r.matricula_id;

    v_fan := v_fan + 1;
  END LOOP;

  RETURN v_fan;
END;
$$;

REVOKE ALL ON FUNCTION public.encuentro_sesion_zoom_evento(bigint,uuid,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
-- service_role lo llama desde el edge function zoom-webhook.

COMMENT ON FUNCTION public.encuentro_sesion_zoom_evento(bigint,uuid,text,timestamptz,jsonb) IS
  'F11/DGG-79: registra join/leave en una SESIÓN compartida y abanica el presente a todas las matrículas activas de la persona en los cursos enganchados.';

-- 2) Estado de la sesión (meeting.started / ended) --------------------------
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_estado(
  p_meeting_id  bigint,
  p_estado      text,
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

  UPDATE public.encuentro_sesiones_compartidas
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

REVOKE ALL ON FUNCTION public.encuentro_sesion_zoom_estado(bigint,text,timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.encuentro_sesion_zoom_estado(bigint,text,timestamptz) IS
  'F11/DGG-79: edge fn zoom-webhook actualiza el estado de la sesión compartida (started/ended).';

-- 3) Grabación de la sesión (recording.completed) ---------------------------
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_grabacion(
  p_meeting_id         bigint,
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
  UPDATE public.encuentro_sesiones_compartidas
     SET grabacion_url      = p_grabacion_url,
         grabacion_play_url = COALESCE(p_grabacion_play_url, p_grabacion_url)
   WHERE zoom_meeting_id = p_meeting_id
   RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encuentro_sesion_zoom_grabacion(bigint,text,text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.encuentro_sesion_zoom_grabacion(bigint,text,text) IS
  'F11/DGG-79: edge fn zoom-webhook guarda la URL de grabación de la sesión compartida.';
