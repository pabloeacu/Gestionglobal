-- ============================================================================
-- 0393 · E-GG-163 · Reconciliación de asistencia Zoom DEFINITIVA
--
-- Segunda falla en producción (reporte de Pablo, encuentro 27/07: 34 personas
-- en sala, 82 eventos webhook, 0 presentes tras el cierre). Causa raíz doble:
--   1. El "matching por nombre" del diseño E-GG-145 NUNCA se implementó: la
--      RPC matcheaba sólo customer_key + email — y los invitados de Zoom
--      llegan SIN email (lección ya documentada) → 0 matches garantizado.
--   2. La RPC sellaba asistencia_reconciliada_at SIEMPRE (aun con payload
--      vacío o 0 matches) → el cron jamás reintentaba.
--
-- Fix definitivo (3 capas):
--   A. Matching por NOMBRE normalizado (3er escalón): sin tildes ni signos,
--      tokens en cualquier orden, contención de conjuntos, y sólo si el
--      candidato es ÚNICO (ambiguo → pase manual, jamás adivinar).
--   B. La RPC fusiona SIEMPRE los eventos webhook propios
--      (curso_encuentro_zoom_eventos: user_name + join/leave que YA están en
--      nuestra BD) con el reporte de la API → si Zoom no da reporte o lo da
--      vacío/sin nombres, reconciliamos igual con lo nuestro.
--   C. Sellado honesto: NO se sella si el payload total quedó vacío, ni
--      antes de 10 min del cierre (reporte de Zoom tarda en generarse);
--      el cron (15 min) reintenta hasta sellar con datos.
--
-- R16: misma firma (uuid, jsonb) → CREATE OR REPLACE sin overload.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.zoom_norm_tokens(p_nombre text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(t ORDER BY t), '{}')
  FROM (
    SELECT DISTINCT tok AS t
    FROM unnest(string_to_array(
      trim(regexp_replace(
        lower(translate(COALESCE(p_nombre,''),
          'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
        '[^a-z0-9]+', ' ', 'g')), ' ')) AS tok
    WHERE length(tok) >= 2
  ) x
$$;

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
  v_finalizado_at timestamptz;
  v_matched int := 0;
  v_total_parts int := 0;
  v_sellar boolean;
  v_sin_match jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT e.curso_id, e.duracion_min*60, c.presencia_minima_pct, e.finalizado_at
    INTO v_curso_id, v_duracion_seg, v_pct_min, v_finalizado_at
    FROM public.curso_encuentros e
    JOIN public.cursos c ON c.id = e.curso_id
   WHERE e.id = p_encuentro_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'encuentro % no encontrado', p_encuentro_id;
  END IF;

  FOR r IN
    WITH api_parts AS (
      -- Fuente 1: el reporte oficial de la API de Zoom (si vino).
      SELECT
        NULLIF(trim(x->>'customer_key'), '') AS customer_key,
        lower(NULLIF(trim(x->>'email'), '')) AS email,
        NULLIF(trim(x->>'nombre'), '')       AS nombre,
        (x->>'join_time')::timestamptz        AS join_time,
        (x->>'leave_time')::timestamptz       AS leave_time,
        COALESCE((x->>'duration_seg')::int, 0) AS duration_seg
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) AS x
    ),
    webhook_parts AS (
      -- Fuente 2 (E-GG-163): NUESTROS eventos webhook — siempre disponibles.
      -- Agrupa por participant_uuid; duración = suma de pares join→leave
      -- (leave faltante = corte de la reunión).
      SELECT
        NULL::text AS customer_key,
        NULL::text AS email,
        MIN(NULLIF(trim(z.raw_payload->>'user_name'), '')) AS nombre,
        MIN(z.ocurrido_at) FILTER (WHERE z.evento = 'join')  AS join_time,
        MAX(z.ocurrido_at) FILTER (WHERE z.evento = 'leave') AS leave_time,
        GREATEST(0, EXTRACT(EPOCH FROM (
          COALESCE(MAX(z.ocurrido_at) FILTER (WHERE z.evento = 'leave'), v_finalizado_at, now())
          - MIN(z.ocurrido_at) FILTER (WHERE z.evento = 'join')
        )))::int AS duration_seg
      FROM public.curso_encuentro_zoom_eventos z
      WHERE z.encuentro_id = p_encuentro_id
        AND z.matricula_id IS NULL          -- los identificados ya asistieron en vivo
        AND NULLIF(trim(z.raw_payload->>'user_name'), '') IS NOT NULL
      GROUP BY COALESCE(z.raw_payload->>'participant_uuid', z.raw_payload->>'user_id',
               z.raw_payload->>'user_name')
    ),
    parts AS (
      SELECT * FROM api_parts
      UNION ALL
      SELECT * FROM webhook_parts
    ),
    resueltas AS (
      SELECT p.*,
        COALESCE(
          -- 1º customer_key (matrícula exacta del curso).
          (SELECT m.id FROM public.curso_matriculas m
            WHERE m.curso_id = v_curso_id
              AND m.id = CASE WHEN p.customer_key ~* '^[0-9a-f-]{36}$'
                              THEN p.customer_key::uuid END),
          -- 2º email contra las matrículas del curso.
          (SELECT m.id FROM public.curso_matriculas m
             JOIN auth.users u ON u.id = m.profile_id
            WHERE m.curso_id = v_curso_id
              AND p.email IS NOT NULL
              AND lower(u.email) = p.email
              AND m.estado IN ('activa','completada')
            LIMIT 1),
          -- 3º NOMBRE normalizado (E-GG-163): contención de conjuntos de
          -- tokens en cualquier orden, y SOLO si el candidato es único.
          (SELECT CASE WHEN count(*) = 1 THEN min(cand.mid::text)::uuid END
             FROM (
               SELECT m.id AS mid
                 FROM public.curso_matriculas m
                 JOIN public.profiles pr ON pr.id = m.profile_id
                WHERE m.curso_id = v_curso_id
                  AND m.estado IN ('activa','completada')
                  AND cardinality(private.zoom_norm_tokens(p.nombre)) >= 2
                  AND (
                    private.zoom_norm_tokens(p.nombre) <@ private.zoom_norm_tokens(pr.full_name)
                    OR private.zoom_norm_tokens(pr.full_name) <@ private.zoom_norm_tokens(p.nombre)
                  )
             ) cand)
        ) AS matricula_id
      FROM parts p
    )
    SELECT matricula_id,
           SUM(duration_seg)  AS total_seg,
           MIN(join_time)     AS primer_join,
           MAX(leave_time)    AS ultimo_leave,
           count(*)           AS n_parts,
           jsonb_agg(jsonb_build_object('nombre', nombre, 'email', email))
             FILTER (WHERE matricula_id IS NULL) AS descartes
      FROM resueltas
     GROUP BY matricula_id
  LOOP
    v_total_parts := v_total_parts + r.n_parts;
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

  -- E-GG-163: sellado HONESTO — sólo con datos y con el reporte maduro.
  -- Sin participantes de ninguna fuente, o a <10 min del cierre, NO se
  -- sella: el cron de 15 min reintenta hasta reconciliar de verdad.
  v_sellar := v_total_parts > 0
              AND (v_finalizado_at IS NULL OR now() - v_finalizado_at > interval '10 minutes');
  IF v_sellar THEN
    UPDATE public.curso_encuentros
       SET asistencia_reconciliada_at = now()
     WHERE id = p_encuentro_id;
  END IF;

  RETURN jsonb_build_object(
    'encuentro_id', p_encuentro_id,
    'matched', v_matched,
    'participantes', v_total_parts,
    'sellado', v_sellar,
    'sin_match', v_sin_match
  );
END;
$function$;
