-- 0373 · E-GG-145 ronda 2 — veredicto de la auditoría §6 (4 críticos)
--
-- C1/C2 · La RPC del webhook DEGRADABA asistencia consolidada: un join/leave
--   tardío o reenviado pisaba fuente ('mixto'/'zoom_report' → 'zoom_auto'),
--   recomputaba presente desde los eventos webhook (posiblemente 0) y
--   destruía la marca manual del gerente o la reconciliación (confirmado e2e
--   por los auditores con DO+ROLLBACK). Fix: fuente preserva mixto/zoom_report
--   (solo manual→mixto) y el recompute es MONÓTONO (tiempo GREATEST, flags OR,
--   presente nunca baja salvo en fuente zoom_auto pura, donde el umbral sobre
--   el tiempo monotónico tampoco puede bajar).
-- C-cron · Los crons con current_setting('app.supabase_url'/'app.cron_secret')
--   fallaban el 100% de sus corridas (GUCs inexistentes → url NULL). Afectaba
--   al job nuevo 23 Y a 3 PRE-EXISTENTES silenciosamente rotos:
--   7 dispatch-vencimientos-diario (bearer NULL → 401 diario),
--   16 gg-email-bounces-30min (bearer NULL → 401 cada 30min, visible en logs),
--   17 db-health-alert-check-daily (url NULL → nunca envió).
--   Fix: recrear los 4 con URL y bearer LITERALES (patrón de los crons sanos).
-- Menores: casts defensivos en el reporte (un participante malformado o un
--   customer_key tampereado ya no aborta el batch — uuid regex estricta +
--   private.safe_ts/safe_int); asistencia_reconciliada_at solo se estampa si
--   el reporte trajo participantes (un [] transitorio no cierra el gate).

-- ── Helpers de cast defensivo ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.safe_ts(p text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.safe_int(p text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p::int;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- ── C1/C2 · RPC base monotónica (misma firma → sin overload, R16) ────────
CREATE OR REPLACE FUNCTION public.curso_encuentro_zoom_evento(
  p_meeting_id bigint,
  p_matricula_id uuid,
  p_evento text,
  p_ocurrido_at timestamptz,
  p_payload jsonb DEFAULT NULL::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_encuentro_id uuid;
  v_duracion_seg int;
  v_pct_min int;
  v_total_seg int;
  v_log_id uuid;
BEGIN
  SELECT id INTO v_encuentro_id FROM public.curso_encuentros WHERE zoom_meeting_id = p_meeting_id;
  IF v_encuentro_id IS NULL THEN
    RAISE EXCEPTION 'encuentro no encontrado para meeting_id=%', p_meeting_id;
  END IF;
  IF p_evento NOT IN ('join','leave') THEN
    RAISE EXCEPTION 'evento inválido: %', p_evento;
  END IF;

  INSERT INTO public.curso_encuentro_zoom_eventos(encuentro_id, matricula_id, evento, ocurrido_at, raw_payload)
    VALUES (v_encuentro_id, p_matricula_id, p_evento, p_ocurrido_at, p_payload)
    RETURNING id INTO v_log_id;

  IF p_matricula_id IS NULL THEN
    RETURN v_log_id;
  END IF;

  INSERT INTO public.curso_encuentro_asistencias(
    encuentro_id, matricula_id, presente, fuente, unido_at, marcada_at
  ) VALUES (
    v_encuentro_id, p_matricula_id, false, 'zoom_auto',
    CASE WHEN p_evento='join' THEN p_ocurrido_at END, now()
  )
  ON CONFLICT (encuentro_id, matricula_id) DO UPDATE
     SET unido_at = COALESCE(curso_encuentro_asistencias.unido_at,
                             CASE WHEN p_evento='join' THEN p_ocurrido_at END),
         salido_at = CASE WHEN p_evento='leave' THEN p_ocurrido_at
                          ELSE curso_encuentro_asistencias.salido_at END,
         -- E-GG-145 r2: manual→mixto; mixto y zoom_report SE PRESERVAN
         -- (antes caían al ELSE 'zoom_auto' y habilitaban la degradación).
         fuente = CASE
           WHEN curso_encuentro_asistencias.fuente = 'manual' THEN 'mixto'
           WHEN curso_encuentro_asistencias.fuente IN ('mixto','zoom_report')
             THEN curso_encuentro_asistencias.fuente
           ELSE 'zoom_auto' END;

  WITH eventos AS (
    SELECT evento, ocurrido_at, row_number() OVER (ORDER BY ocurrido_at) AS rn
      FROM (
        SELECT DISTINCT evento, ocurrido_at
          FROM public.curso_encuentro_zoom_eventos
         WHERE encuentro_id = v_encuentro_id AND matricula_id = p_matricula_id
      ) d
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

  -- E-GG-145 r2: recompute MONÓTONO — el tiempo solo sube (GREATEST contra lo
  -- ya consolidado por reconciliación/webhook previo), las flags solo suben
  -- (OR), y presente jamás baja salvo en fuente zoom_auto pura, donde sigue
  -- al umbral sobre el tiempo monotónico (que tampoco puede bajar).
  UPDATE public.curso_encuentro_asistencias
     SET tiempo_conectado_seg = GREATEST(COALESCE(tiempo_conectado_seg,0), v_total_seg),
         umbral_cumplido = umbral_cumplido OR
           (GREATEST(COALESCE(tiempo_conectado_seg,0), v_total_seg) * 100
              >= v_duracion_seg * COALESCE(v_pct_min,50)),
         auto_presente = auto_presente OR
           (GREATEST(COALESCE(tiempo_conectado_seg,0), v_total_seg) * 100
              >= v_duracion_seg * COALESCE(v_pct_min,50)),
         presente = CASE
           WHEN fuente = 'zoom_auto'
             THEN (GREATEST(COALESCE(tiempo_conectado_seg,0), v_total_seg) * 100
                     >= v_duracion_seg * COALESCE(v_pct_min,50))
           ELSE presente OR
             (GREATEST(COALESCE(tiempo_conectado_seg,0), v_total_seg) * 100
                >= v_duracion_seg * COALESCE(v_pct_min,50))
           END
   WHERE encuentro_id = v_encuentro_id AND matricula_id = p_matricula_id;

  RETURN v_log_id;
END;
$function$;

-- ── Reconciliador con casts defensivos + stamp condicional ───────────────
CREATE OR REPLACE FUNCTION public.curso_encuentro_reconciliar_asistencia(
  p_encuentro_id uuid,
  p_participantes jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso_id uuid;
  v_duracion_seg int;
  v_pct_min int;
  v_matched int := 0;
  v_sin_match jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT e.curso_id, e.duracion_min*60, c.presencia_minima_pct
    INTO v_curso_id, v_duracion_seg, v_pct_min
    FROM public.curso_encuentros e
    JOIN public.cursos c ON c.id = e.curso_id
   WHERE e.id = p_encuentro_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'encuentro % no encontrado', p_encuentro_id;
  END IF;

  FOR r IN
    WITH parts AS (
      SELECT
        NULLIF(trim(x->>'customer_key'), '') AS customer_key,
        lower(NULLIF(trim(x->>'email'), '')) AS email,
        NULLIF(trim(x->>'nombre'), '')       AS nombre,
        -- E-GG-145 r2: casts defensivos — un participante malformado (o un
        -- customer_key tampereado desde el browser) no aborta el batch.
        private.safe_ts(x->>'join_time')      AS join_time,
        private.safe_ts(x->>'leave_time')     AS leave_time,
        GREATEST(COALESCE(private.safe_int(x->>'duration_seg'), 0), 0) AS duration_seg
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) AS x
    ),
    resueltas AS (
      SELECT p.*,
        COALESCE(
          (SELECT m.id FROM public.curso_matriculas m
            WHERE m.curso_id = v_curso_id
              AND m.id = CASE WHEN p.customer_key ~*
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                              THEN p.customer_key::uuid END),
          (SELECT m.id FROM public.curso_matriculas m
             JOIN auth.users u ON u.id = m.profile_id
            WHERE m.curso_id = v_curso_id
              AND p.email IS NOT NULL
              AND lower(u.email) = p.email
              AND m.estado IN ('activa','completada')
            LIMIT 1)
        ) AS matricula_id
      FROM parts p
    )
    SELECT matricula_id,
           SUM(duration_seg)  AS total_seg,
           MIN(join_time)     AS primer_join,
           MAX(leave_time)    AS ultimo_leave,
           jsonb_agg(jsonb_build_object('nombre', nombre, 'email', email))
             FILTER (WHERE matricula_id IS NULL) AS descartes
      FROM resueltas
     GROUP BY matricula_id
  LOOP
    IF r.matricula_id IS NULL THEN
      v_sin_match := COALESCE(r.descartes, '[]'::jsonb);
      CONTINUE;
    END IF;
    v_matched := v_matched + 1;

    INSERT INTO public.curso_encuentro_asistencias(
      encuentro_id, matricula_id, presente, fuente,
      unido_at, salido_at, tiempo_conectado_seg,
      umbral_cumplido, auto_presente, marcada_at
    ) VALUES (
      p_encuentro_id, r.matricula_id,
      (r.total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
      'zoom_report',
      r.primer_join, r.ultimo_leave, r.total_seg,
      (r.total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
      (r.total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
      now()
    )
    ON CONFLICT (encuentro_id, matricula_id) DO UPDATE SET
      tiempo_conectado_seg = GREATEST(
        COALESCE(curso_encuentro_asistencias.tiempo_conectado_seg, 0), EXCLUDED.tiempo_conectado_seg),
      unido_at  = LEAST(
        COALESCE(curso_encuentro_asistencias.unido_at,  EXCLUDED.unido_at),  EXCLUDED.unido_at),
      salido_at = GREATEST(
        COALESCE(curso_encuentro_asistencias.salido_at, EXCLUDED.salido_at), EXCLUDED.salido_at),
      umbral_cumplido = (curso_encuentro_asistencias.umbral_cumplido OR EXCLUDED.umbral_cumplido),
      auto_presente   = (curso_encuentro_asistencias.auto_presente   OR EXCLUDED.auto_presente),
      presente = (curso_encuentro_asistencias.presente OR EXCLUDED.presente),
      fuente = CASE
        WHEN curso_encuentro_asistencias.fuente = 'manual' THEN 'mixto'
        ELSE curso_encuentro_asistencias.fuente
      END,
      marcada_at = now();
  END LOOP;

  -- E-GG-145 r2: un reporte vacío (Zoom todavía generándolo tras meeting.ended)
  -- NO cierra el gate — el cron reintenta hasta obtener participantes.
  IF jsonb_array_length(COALESCE(p_participantes, '[]'::jsonb)) > 0 THEN
    UPDATE public.curso_encuentros
       SET asistencia_reconciliada_at = now()
     WHERE id = p_encuentro_id;
  END IF;

  RETURN jsonb_build_object(
    'encuentro_id', p_encuentro_id,
    'matched', v_matched,
    'sin_match', v_sin_match
  );
END;
$function$;

-- ── Crons: los 4 rotos por GUCs inexistentes → literales ─────────────────
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'dispatch-vencimientos-diario','gg-email-bounces-30min',
    'db-health-alert-check-daily','gg-zoom-reconciliar-asistencia'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule('dispatch-vencimientos-diario', '0 12 * * *', $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-vencimientos',
    headers := jsonb_build_object(
      'Authorization', 'Bearer gg_cron_c3500aaaf64c4304bd4f775d3b141136',
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
  $cron$);

SELECT cron.schedule('gg-email-bounces-30min', '*/30 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/email-bounce-harvester',
    headers := jsonb_build_object(
      'Authorization', 'Bearer gg_cron_c3500aaaf64c4304bd4f775d3b141136',
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
  $cron$);

SELECT cron.schedule('db-health-alert-check-daily', '0 12 * * *', $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/db-health-alert-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer gg_cron_c3500aaaf64c4304bd4f775d3b141136',
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
  $cron$);

SELECT cron.schedule('gg-zoom-reconciliar-asistencia', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/zoom-reconciliar-asistencia',
    headers := jsonb_build_object(
      'Authorization', 'Bearer gg_cron_c3500aaaf64c4304bd4f775d3b141136',
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
  $cron$);
