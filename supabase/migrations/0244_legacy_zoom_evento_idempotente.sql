-- ============================================================================
-- 0244_legacy_zoom_evento_idempotente.sql
-- E-GG-69 (hardening legacy) · Idempotencia del webhook de asistencia standalone.
--
-- public.curso_encuentro_zoom_evento (0047) recomputa tiempo_conectado_seg desde
-- el log curso_encuentro_zoom_eventos SIN deduplicar. Zoom entrega webhooks
-- at-least-once → un join/leave reenviado se aparea de nuevo e infla el tiempo,
-- pudiendo flipear presente→true falsamente. Mismo bug que ya se corrigió en el
-- pipeline de sesiones compartidas (0239). Fix idéntico: dedupe exacto
-- (evento, ocurrido_at) en el CTE `eventos` antes de aparear join/leave.
--
-- CREATE OR REPLACE con la MISMA firma (R16: no crea overload). Resto del cuerpo
-- intacto respecto de 0047. REVOKE preservado (solo service_role la invoca).
-- ============================================================================

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

  -- Recompute tiempo conectado: dedupe exacto (evento, ocurrido_at) para que un
  -- webhook reenviado por Zoom (at-least-once) no infle el tiempo ni el presente.
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
$$;

REVOKE ALL ON FUNCTION public.curso_encuentro_zoom_evento(bigint,uuid,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
-- service_role la invoca desde el edge function zoom-webhook.
