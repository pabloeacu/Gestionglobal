-- ============================================================================
-- 0239_f11_audit_fixes.sql
-- F11/DGG-79 · Fixes de la auditoría §6 (E-GG-79)
--
-- (1) R11: índice faltante en la FK encuentro_sesiones_compartidas.created_by.
-- (2) Idempotencia del fan-out: Zoom entrega webhooks at-least-once; un evento
--     reenviado inflaba tiempo_conectado_seg (y podía flipear presente a true).
--     Dedupe exacto (evento, ocurrido_at) en el CTE antes de aparear join/leave.
--     (El pipeline legacy curso_encuentro_zoom_evento tiene el mismo patrón —
--      queda documentado como paridad pre-existente en ERRORES.md, no se toca
--      acá para no ampliar superficie sobre el flujo en producción.)
-- ============================================================================

-- (1) Índice de FK (R11)
CREATE INDEX IF NOT EXISTS idx_sesiones_compartidas_created_by
  ON public.encuentro_sesiones_compartidas(created_by)
  WHERE created_by IS NOT NULL;

-- (2) Fan-out idempotente
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_evento(
  p_meeting_id   bigint,
  p_matricula_id uuid,
  p_evento       text,
  p_ocurrido_at  timestamptz,
  p_payload      jsonb DEFAULT NULL
) RETURNS integer
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

  SELECT id, COALESCE(duracion_min,60) * 60
    INTO v_sesion_id, v_duracion_seg
    FROM public.encuentro_sesiones_compartidas
   WHERE zoom_meeting_id = p_meeting_id;
  IF v_sesion_id IS NULL THEN
    RAISE EXCEPTION 'sesión compartida no encontrada para meeting_id=%', p_meeting_id;
  END IF;

  SELECT profile_id INTO v_profile_id
    FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'matrícula % no encontrada (no se puede resolver persona)', p_matricula_id;
  END IF;

  FOR r IN
    SELECT e.id AS encuentro_id, e.curso_id, m.id AS matricula_id
      FROM public.curso_encuentros e
      JOIN public.curso_matriculas m
        ON m.curso_id = e.curso_id
       AND m.profile_id = v_profile_id
       AND m.estado IN ('activa','completada')
     WHERE e.sesion_compartida_id = v_sesion_id
  LOOP
    INSERT INTO public.curso_encuentro_zoom_eventos(
      encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
    ) VALUES (r.encuentro_id, r.matricula_id, p_evento, p_ocurrido_at, p_payload);

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

    -- Recompute tiempo conectado: dedupe exacto (evento, ocurrido_at) para que
    -- un webhook reenviado por Zoom (at-least-once) no infle el tiempo ni el
    -- presente. Luego apareo cada join con su primer leave posterior.
    WITH eventos AS (
      SELECT evento, ocurrido_at,
             row_number() OVER (ORDER BY ocurrido_at) AS rn
        FROM (
          SELECT DISTINCT evento, ocurrido_at
            FROM public.curso_encuentro_zoom_eventos
           WHERE encuentro_id = r.encuentro_id AND matricula_id = r.matricula_id
        ) d
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

    SELECT c.presencia_minima_pct INTO v_pct_min
      FROM public.cursos c WHERE c.id = r.curso_id;

    UPDATE public.curso_encuentro_asistencias
       SET tiempo_conectado_seg = v_total_seg,
           umbral_cumplido = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           auto_presente   = (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)),
           presente = CASE
             WHEN fuente='zoom_auto'
               THEN (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))
             ELSE presente
           END
     WHERE encuentro_id = r.encuentro_id AND matricula_id = r.matricula_id;

    v_fan := v_fan + 1;
  END LOOP;

  RETURN v_fan;
END;
$$;

REVOKE ALL ON FUNCTION public.encuentro_sesion_zoom_evento(bigint,uuid,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.encuentro_sesion_zoom_evento(bigint,uuid,text,timestamptz,jsonb) IS
  'F11/DGG-79: registra join/leave en una SESIÓN compartida y abanica el presente a todas las matrículas activas de la persona en los cursos enganchados. Idempotente ante reenvíos de webhook (dedupe evento+ocurrido_at).';
