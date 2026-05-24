-- DGG-19 · RPCs para tracking de asistencia Webex.
-- Mirror de las RPCs Zoom pero usando webex_meeting_id (text).
-- Re-usa la tabla curso_encuentro_zoom_eventos (es genérica).

CREATE OR REPLACE FUNCTION public.webex_encuentro_started(
  p_webex_meeting_id text,
  p_started_at timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.curso_encuentros
     SET webex_status = 'en_curso',
         iniciado_at = COALESCE(iniciado_at, p_started_at)
   WHERE webex_meeting_id = p_webex_meeting_id
   RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.webex_encuentro_ended(
  p_webex_meeting_id text,
  p_ended_at timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.curso_encuentros
     SET webex_status = 'finalizado',
         finalizado_at = COALESCE(finalizado_at, p_ended_at)
   WHERE webex_meeting_id = p_webex_meeting_id
   RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.webex_participant_joined(
  p_webex_meeting_id text,
  p_customer_key uuid,
  p_joined_at timestamp with time zone,
  p_display_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_encuentro_id uuid;
  v_log_id uuid;
BEGIN
  SELECT id INTO v_encuentro_id
    FROM public.curso_encuentros
   WHERE webex_meeting_id = p_webex_meeting_id;
  IF v_encuentro_id IS NULL THEN
    RAISE EXCEPTION 'webex encuentro no encontrado: %', p_webex_meeting_id;
  END IF;

  INSERT INTO public.curso_encuentro_zoom_eventos(
    encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
  ) VALUES (
    v_encuentro_id, p_customer_key, 'join', p_joined_at,
    jsonb_build_object('plataforma','webex','display_name',p_display_name)
  ) RETURNING id INTO v_log_id;

  IF p_customer_key IS NOT NULL THEN
    INSERT INTO public.curso_encuentro_asistencias(
      encuentro_id, matricula_id, presente, fuente, unido_at, marcada_at
    ) VALUES (
      v_encuentro_id, p_customer_key, false, 'webex_auto', p_joined_at, now()
    )
    ON CONFLICT (encuentro_id, matricula_id) DO UPDATE
       SET unido_at = COALESCE(curso_encuentro_asistencias.unido_at, p_joined_at),
           fuente = CASE WHEN curso_encuentro_asistencias.fuente='manual'
                         THEN 'mixto' ELSE 'webex_auto' END;
  END IF;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.webex_participant_left(
  p_webex_meeting_id text,
  p_customer_key uuid,
  p_left_at timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_encuentro_id uuid;
  v_duracion_seg int;
  v_pct_min int;
  v_total_seg int;
  v_log_id uuid;
BEGIN
  SELECT id INTO v_encuentro_id
    FROM public.curso_encuentros
   WHERE webex_meeting_id = p_webex_meeting_id;
  IF v_encuentro_id IS NULL THEN
    RAISE EXCEPTION 'webex encuentro no encontrado: %', p_webex_meeting_id;
  END IF;

  INSERT INTO public.curso_encuentro_zoom_eventos(
    encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
  ) VALUES (
    v_encuentro_id, p_customer_key, 'leave', p_left_at,
    jsonb_build_object('plataforma','webex')
  ) RETURNING id INTO v_log_id;

  IF p_customer_key IS NOT NULL THEN
    UPDATE public.curso_encuentro_asistencias
       SET salido_at = p_left_at
     WHERE encuentro_id = v_encuentro_id AND matricula_id = p_customer_key;

    WITH eventos AS (
      SELECT evento, ocurrido_at, row_number() OVER (ORDER BY ocurrido_at) AS rn
        FROM public.curso_encuentro_zoom_eventos
       WHERE encuentro_id = v_encuentro_id AND matricula_id = p_customer_key
    ),
    pares AS (
      SELECT j.ocurrido_at AS unido,
             (SELECT MIN(l.ocurrido_at) FROM eventos l WHERE l.evento='leave' AND l.rn > j.rn) AS salido
        FROM eventos j WHERE j.evento='join'
    ),
    total AS (
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(salido, now()) - unido))::int), 0) AS seg FROM pares
    )
    SELECT seg INTO v_total_seg FROM total;

    SELECT c.presencia_minima_pct, e.duracion_min*60
      INTO v_pct_min, v_duracion_seg
      FROM public.curso_encuentros e
      JOIN public.cursos c ON c.id = e.curso_id
     WHERE e.id = v_encuentro_id;

    UPDATE public.curso_encuentro_asistencias
       SET tiempo_conectado_seg = v_total_seg,
           umbral_cumplido = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           auto_presente = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           presente = CASE WHEN fuente='webex_auto'
                           THEN (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))
                           ELSE presente END
     WHERE encuentro_id = v_encuentro_id AND matricula_id = p_customer_key;
  END IF;

  RETURN v_log_id;
END;
$$;
