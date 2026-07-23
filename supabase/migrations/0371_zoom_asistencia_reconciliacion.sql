-- 0371 · E-GG-145 — Asistencia Zoom a prueba de fallas (doble vía)
--
-- Contexto: la asistencia automática de encuentros Zoom standalone dependía de
-- que el participante entrara por el SDK embebido (customer_key = matricula_id).
-- El campus ofrecía el link crudo → customer_key nunca viajaba → el webhook
-- descartaba los join/leave EN SILENCIO (0 filas, 0 logs). Caso real: Encuentro
-- Julio 22/07, alumno presente en sala e invisible en la plataforma.
--
-- Este chunk agrega:
--   1) Log SIEMPRE: curso_encuentro_zoom_eventos.matricula_id ahora es NULLABLE
--      → los participantes sin identidad quedan registrados con payload crudo.
--   2) RPC curso_encuentro_zoom_evento acepta p_matricula_id NULL (solo log).
--   3) RPC curso_encuentro_zoom_evento_por_email: fallback de identidad por
--      email del participante (cuando Zoom lo manda) contra las matrículas.
--   4) Reconciliación post-reunión (la garantía): RPC
--      curso_encuentro_reconciliar_asistencia(p_encuentro_id, p_participantes)
--      consume el reporte oficial de participantes de Zoom y computa asistencia
--      SIN degradar nada (nunca pisa manual, nunca baja presente=true).
--   5) curso_encuentros.asistencia_reconciliada_at + RPC de pendientes + cron
--      cada 15 min → edge fn zoom-reconciliar-asistencia (cinturón y tiradores).
--
-- R12: RPCs nuevas solo alcanzables por service_role/staff → guard
-- private.is_staff_or_service() (lección E-GG-127/143).

-- ── 1) Log de participantes sin identidad ────────────────────────────────
ALTER TABLE public.curso_encuentro_zoom_eventos
  ALTER COLUMN matricula_id DROP NOT NULL;

-- ── 2) fuente 'zoom_report' en asistencias ───────────────────────────────
DO $$
DECLARE v_con text;
BEGIN
  SELECT c.conname INTO v_con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.curso_encuentro_asistencias'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%fuente%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.curso_encuentro_asistencias DROP CONSTRAINT %I', v_con);
  END IF;
  ALTER TABLE public.curso_encuentro_asistencias
    ADD CONSTRAINT curso_encuentro_asistencias_fuente_check
    CHECK (fuente = ANY (ARRAY['manual','zoom_auto','mixto','zoom_report']));
END $$;

-- ── 3) Marca de reconciliación en el encuentro ───────────────────────────
ALTER TABLE public.curso_encuentros
  ADD COLUMN IF NOT EXISTS asistencia_reconciliada_at timestamptz;

-- ── 4) RPC base: p_matricula_id NULL = solo log (misma firma → sin overload,
--       R16: CREATE OR REPLACE es seguro porque la cantidad/tipos no cambian) ──
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

  -- E-GG-145: sin matrícula no hay asistencia que computar — el log crudo
  -- queda para trazabilidad y reconciliación posterior.
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
         fuente = CASE WHEN curso_encuentro_asistencias.fuente='manual'
                       THEN 'mixto' ELSE 'zoom_auto' END;

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

  UPDATE public.curso_encuentro_asistencias
     SET tiempo_conectado_seg = v_total_seg,
         umbral_cumplido = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
         auto_presente = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
         presente = CASE WHEN fuente='zoom_auto'
                         THEN (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))
                         ELSE presente END
   WHERE encuentro_id = v_encuentro_id AND matricula_id = p_matricula_id;

  RETURN v_log_id;
END;
$function$;

-- ── 4b) Fallback por email (nombre nuevo → cero riesgo de overload) ──────
CREATE FUNCTION public.curso_encuentro_zoom_evento_por_email(
  p_meeting_id bigint,
  p_email text,
  p_evento text,
  p_ocurrido_at timestamptz,
  p_payload jsonb DEFAULT NULL::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso_id uuid;
  v_matricula_id uuid;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT curso_id INTO v_curso_id FROM public.curso_encuentros WHERE zoom_meeting_id = p_meeting_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'encuentro no encontrado para meeting_id=%', p_meeting_id;
  END IF;

  IF COALESCE(trim(p_email), '') <> '' THEN
    SELECT m.id INTO v_matricula_id
      FROM public.curso_matriculas m
      JOIN auth.users u ON u.id = m.profile_id
     WHERE m.curso_id = v_curso_id
       AND lower(u.email) = lower(trim(p_email))
       AND m.estado IN ('activa','completada')
     LIMIT 1;
  END IF;

  -- Con o sin match, el evento SIEMPRE queda registrado (matricula NULL = log).
  RETURN public.curso_encuentro_zoom_evento(
    p_meeting_id, v_matricula_id, p_evento, p_ocurrido_at, p_payload
  );
END;
$function$;

-- ── 5) Reconciliación post-reunión con el reporte oficial de Zoom ────────
-- p_participantes: jsonb array de
--   { customer_key, email, nombre, join_time, leave_time, duration_seg }
-- Nunca degrada: manual→mixto (presente se conserva), presente=true jamás
-- baja, tiempo toma el MÁXIMO entre lo ya computado y el reporte.
CREATE FUNCTION public.curso_encuentro_reconciliar_asistencia(
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
        (x->>'join_time')::timestamptz        AS join_time,
        (x->>'leave_time')::timestamptz       AS leave_time,
        COALESCE((x->>'duration_seg')::int, 0) AS duration_seg
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) AS x
    ),
    resueltas AS (
      SELECT p.*,
        COALESCE(
          -- 1º customer_key (matrícula exacta del curso). CASE evita castear
          -- a uuid un valor no-uuid (SQL no garantiza short-circuit en AND).
          (SELECT m.id FROM public.curso_matriculas m
            WHERE m.curso_id = v_curso_id
              AND m.id = CASE WHEN p.customer_key ~* '^[0-9a-f-]{36}$'
                              THEN p.customer_key::uuid END),
          -- 2º email contra las matrículas del curso
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
      -- Nunca degradar: presente solo puede subir.
      presente = (curso_encuentro_asistencias.presente OR EXCLUDED.presente),
      fuente = CASE
        WHEN curso_encuentro_asistencias.fuente = 'manual' THEN 'mixto'
        ELSE curso_encuentro_asistencias.fuente
      END,
      marcada_at = now();
  END LOOP;

  UPDATE public.curso_encuentros
     SET asistencia_reconciliada_at = now()
   WHERE id = p_encuentro_id;

  RETURN jsonb_build_object(
    'encuentro_id', p_encuentro_id,
    'matched', v_matched,
    'sin_match', v_sin_match
  );
END;
$function$;

-- ── 6) Pendientes de reconciliar (para el cron) ──────────────────────────
-- Standalone Zoom cuya ventana terminó (con 10 min de margen para que el
-- reporte exista en Zoom), recientes (36h) y aún sin reconciliar.
CREATE FUNCTION public.zoom_encuentros_pendientes_reconciliar()
RETURNS TABLE (encuentro_id uuid, zoom_meeting_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT e.id, e.zoom_meeting_id
    FROM public.curso_encuentros e
   WHERE e.zoom_meeting_id IS NOT NULL
     AND e.sesion_compartida_id IS NULL
     AND COALESCE(e.plataforma, 'zoom') = 'zoom'
     AND e.asistencia_reconciliada_at IS NULL
     AND e.fecha_hora IS NOT NULL
     AND e.fecha_hora > now() - interval '36 hours'
     AND e.fecha_hora + make_interval(mins => COALESCE(e.duracion_min, 120) + 10) < now();
END;
$function$;

-- ── 7) Cron cada 15 min → edge fn (cinturón del webhook meeting.ended) ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-zoom-reconciliar-asistencia') THEN
    PERFORM cron.unschedule('gg-zoom-reconciliar-asistencia');
  END IF;
END $$;
SELECT cron.schedule(
  'gg-zoom-reconciliar-asistencia',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/zoom-reconciliar-asistencia',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
