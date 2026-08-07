-- 0412 · §6 DGG-131 — cierre de los 6 hallazgos de la auditoría de encuentros
-- compartidos (E-GG-176 el crítico):
--   1. E-GG-176 (CRÍTICO, pre-existente F11): la reconciliación post-reunión
--      excluía TODAS las sesiones compartidas (webhook solo standalone, RPC de
--      pendientes con sesion_compartida_id IS NULL, edge resolviendo solo
--      curso_encuentros) y la rama compartida de participant_joined/left
--      descartaba en silencio a quien entraba sin customer_key (sin fallback
--      por email ni log — el mismo hueco que E-GG-145 erradicó del standalone).
--      → encuentro_sesion_reconciliar_asistencia + zoom_sesiones_pendientes_
--      reconciliar + encuentro_sesion_zoom_evento_por_email (las edges
--      zoom-webhook v9 / zoom-reconciliar-asistencia v2 las consumen).
--   2. encuentro_sesion_zoom_evento gana las protecciones monotónicas de mig
--      0373 que solo tenía la variante standalone: no degrada fuente
--      mixto/zoom_report→zoom_auto, tiempo GREATEST, presente nunca baja.
--   3. gg_encuentros_recordatorio_diario: dedupe por persona+sesión (sin esto,
--      un alumno matriculado en los 2 cursos espejo recibiría 2 mails 8AM).
--   4. private.recompute_asistencia: guard de no-op (no tocar updated_at de
--      38 filas por tanda de encuentros) + respeta el tilde MANUAL de staff
--      (cumplida_por NOT NULL no se baja por recompute).

-- ============================================================
-- 1a · encuentro_sesion_zoom_evento — monotónica (espejo mig 0373)
-- ============================================================
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_evento(
  p_meeting_id bigint, p_matricula_id uuid, p_evento text,
  p_ocurrido_at timestamptz, p_payload jsonb DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
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

    -- 0412: fuente no degrada — manual→mixto, mixto/zoom_report se conservan
    -- (antes cualquier evento las pisaba a zoom_auto y el recálculo por umbral
    -- podía revertir un presente manual o del reporte oficial).
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
           fuente = CASE
             WHEN curso_encuentro_asistencias.fuente = 'manual' THEN 'mixto'
             WHEN curso_encuentro_asistencias.fuente IN ('mixto','zoom_report')
               THEN curso_encuentro_asistencias.fuente
             ELSE 'zoom_auto'
           END;

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

    -- 0412: monotónica — tiempo GREATEST (un recálculo parcial nunca pisa al
    -- reporte oficial), umbral/auto_presente OR, presente nunca baja.
    UPDATE public.curso_encuentro_asistencias
       SET tiempo_conectado_seg = GREATEST(COALESCE(tiempo_conectado_seg, 0), v_total_seg),
           umbral_cumplido = (COALESCE(umbral_cumplido, false)
                              OR (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))),
           auto_presente   = (COALESCE(auto_presente, false)
                              OR (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50))),
           presente = CASE
             WHEN fuente = 'zoom_auto'
               THEN (presente OR (v_total_seg * 100 >= v_duracion_seg * COALESCE(v_pct_min,50)))
             ELSE presente
           END
     WHERE encuentro_id = r.encuentro_id AND matricula_id = r.matricula_id;

    v_fan := v_fan + 1;
  END LOOP;

  RETURN v_fan;
END;
$$;

-- ============================================================
-- 1b · encuentro_sesion_zoom_evento_por_email (NUEVA) — E-GG-145 para
--      sesiones compartidas: fallback por email + log SIEMPRE (sin descartes
--      silenciosos cuando el participante entra por link crudo / app nativa).
-- ============================================================
CREATE OR REPLACE FUNCTION public.encuentro_sesion_zoom_evento_por_email(
  p_meeting_id bigint, p_email text, p_evento text,
  p_ocurrido_at timestamptz, p_payload jsonb DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_sesion_id uuid;
  v_matricula_id uuid;
  v_logs int := 0;
  r record;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_sesion_id
    FROM public.encuentro_sesiones_compartidas
   WHERE zoom_meeting_id = p_meeting_id;
  IF v_sesion_id IS NULL THEN
    RAISE EXCEPTION 'sesión compartida no encontrada para meeting_id=%', p_meeting_id;
  END IF;

  -- Persona por email en CUALQUIER curso enganchado (una matrícula alcanza:
  -- la RPC de sesión abanica al resto por profile).
  IF COALESCE(trim(p_email), '') <> '' THEN
    SELECT m.id INTO v_matricula_id
      FROM public.curso_encuentros e
      JOIN public.curso_matriculas m ON m.curso_id = e.curso_id
      JOIN auth.users u ON u.id = m.profile_id
     WHERE e.sesion_compartida_id = v_sesion_id
       AND lower(u.email) = lower(trim(p_email))
       AND m.estado IN ('activa','completada')
     LIMIT 1;
  END IF;

  IF v_matricula_id IS NOT NULL THEN
    RETURN public.encuentro_sesion_zoom_evento(
      p_meeting_id, v_matricula_id, p_evento, p_ocurrido_at, p_payload);
  END IF;

  -- Sin identidad: log en cada espejo (matricula NULL) — el reconciliador y
  -- el forense por nombre (E-GG-145) los rescatan después.
  FOR r IN
    SELECT e.id FROM public.curso_encuentros e
     WHERE e.sesion_compartida_id = v_sesion_id
  LOOP
    INSERT INTO public.curso_encuentro_zoom_eventos(
      encuentro_id, matricula_id, evento, ocurrido_at, raw_payload
    ) VALUES (r.id, NULL, p_evento, p_ocurrido_at, p_payload);
    v_logs := v_logs + 1;
  END LOOP;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.encuentro_sesion_zoom_evento_por_email(bigint, text, text, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuentro_sesion_zoom_evento_por_email(bigint, text, text, timestamptz, jsonb) TO authenticated, service_role;

-- ============================================================
-- 1c · encuentro_sesion_reconciliar_asistencia (NUEVA) — el reporte oficial
--      de Zoom de una sesión compartida se reconcilia en TODOS los cursos
--      enganchados reutilizando el reconciliador standalone por espejo
--      (matching customer_key → email → nombre único, upsert monotónico).
-- ============================================================
CREATE OR REPLACE FUNCTION public.encuentro_sesion_reconciliar_asistencia(
  p_meeting_id bigint, p_participantes jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_sesion_id uuid;
  v_resultados jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_sesion_id
    FROM public.encuentro_sesiones_compartidas
   WHERE zoom_meeting_id = p_meeting_id;
  IF v_sesion_id IS NULL THEN
    RAISE EXCEPTION 'sesión compartida no encontrada para meeting_id=%', p_meeting_id;
  END IF;

  FOR r IN
    SELECT e.id FROM public.curso_encuentros e
     WHERE e.sesion_compartida_id = v_sesion_id
  LOOP
    v_resultados := v_resultados || jsonb_build_array(
      public.curso_encuentro_reconciliar_asistencia(r.id, p_participantes)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sesion_id', v_sesion_id,
    'meeting_id', p_meeting_id,
    'espejos', jsonb_array_length(v_resultados),
    'resultados', v_resultados
  );
END;
$$;
REVOKE ALL ON FUNCTION public.encuentro_sesion_reconciliar_asistencia(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuentro_sesion_reconciliar_asistencia(bigint, jsonb) TO authenticated, service_role;

-- ============================================================
-- 1d · zoom_sesiones_pendientes_reconciliar (NUEVA) — barrido del cron para
--      sesiones compartidas terminadas con algún espejo sin sellar.
-- ============================================================
CREATE OR REPLACE FUNCTION public.zoom_sesiones_pendientes_reconciliar()
RETURNS TABLE(zoom_meeting_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT s.zoom_meeting_id
    FROM public.encuentro_sesiones_compartidas s
   WHERE s.zoom_meeting_id IS NOT NULL
     AND COALESCE(s.plataforma, 'zoom') = 'zoom'
     AND s.fecha_hora IS NOT NULL
     AND s.fecha_hora > now() - interval '36 hours'
     AND s.fecha_hora + make_interval(mins => COALESCE(s.duracion_min, 120) + 10) < now()
     AND EXISTS (
       SELECT 1 FROM public.curso_encuentros e
        WHERE e.sesion_compartida_id = s.id
          AND e.asistencia_reconciliada_at IS NULL
     );
END;
$$;
REVOKE ALL ON FUNCTION public.zoom_sesiones_pendientes_reconciliar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zoom_sesiones_pendientes_reconciliar() TO authenticated, service_role;

-- ============================================================
-- 2 · recompute_asistencia — guard de no-op + respeta tilde manual de staff
-- ============================================================
CREATE OR REPLACE FUNCTION private.recompute_asistencia(p_matricula_id uuid, p_condicion_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_tipo text; v_modalidad text; v_ok boolean;
BEGIN
  SELECT tipo, modalidad INTO v_tipo, v_modalidad
    FROM public.curso_condiciones_config WHERE id = p_condicion_id;
  IF v_tipo IS DISTINCT FROM 'asistencia' OR v_modalidad IS NULL THEN
    RETURN;
  END IF;
  v_ok := private.eval_asistencia_cumplida(p_matricula_id, p_condicion_id);
  INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at)
  VALUES (p_matricula_id, p_condicion_id, v_ok, CASE WHEN v_ok THEN now() ELSE NULL END)
  ON CONFLICT (matricula_id, condicion_id) DO UPDATE
    SET cumplida = EXCLUDED.cumplida,
        cumplida_at = CASE
          WHEN EXCLUDED.cumplida AND matricula_condiciones.cumplida = false THEN now()
          WHEN NOT EXCLUDED.cumplida THEN NULL
          ELSE matricula_condiciones.cumplida_at END,
        updated_at = now()
  -- 0412 (§6 DGG-131): (a) no-op guard — crear encuentros disparaba el
  -- recompute de TODAS las matrículas y re-escribía updated_at sin cambiar
  -- nada (38 falsos positivos de auditoría por tanda); (b) un tilde MANUAL
  -- de staff (cumplida_por NOT NULL) nunca se baja por recompute automático.
  WHERE matricula_condiciones.cumplida IS DISTINCT FROM EXCLUDED.cumplida
    AND NOT (matricula_condiciones.cumplida
             AND matricula_condiciones.cumplida_por IS NOT NULL
             AND NOT EXCLUDED.cumplida);
END;
$$;

-- ============================================================
-- 3 · gg_encuentros_recordatorio_diario — dedupe por persona+sesión
-- ============================================================
CREATE OR REPLACE FUNCTION public.gg_encuentros_recordatorio_diario()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_enc record;
  v_al record;
  v_ger record;
  v_encolados int;
  v_total int := 0;
  v_encuentros int := 0;
  v_nombres text;
  v_fecha_txt text;
  v_hora_txt text;
BEGIN
  FOR v_enc IN
    SELECT ce.id, ce.titulo,
           COALESCE(s.fecha_hora, ce.fecha_hora) AS fecha_hora,
           COALESCE(s.duracion_min, ce.duracion_min, 60) AS duracion_min,
           ce.condicion_id, ccc.etiqueta AS modulo,
           s.id AS sesion_id,
           c.id AS curso_id, c.titulo AS curso_titulo, c.slug AS curso_slug
    FROM public.curso_encuentros ce
    LEFT JOIN public.encuentro_sesiones_compartidas s ON s.id = ce.sesion_compartida_id
    JOIN public.curso_condiciones_config ccc ON ccc.id = ce.condicion_id
    JOIN public.cursos c ON c.id = ce.curso_id
    WHERE (COALESCE(s.fecha_hora, ce.fecha_hora) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
      AND ccc.obligatoria AND ccc.activa
      AND (
        private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at)
          IN ('publicado','finalizado')
        OR (
          private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at) = 'programado'
          AND c.publicar_at <= COALESCE(s.fecha_hora, ce.fecha_hora)
        )
      )
      AND COALESCE(s.fecha_hora, ce.fecha_hora)
          + make_interval(mins => COALESCE(s.duracion_min, ce.duracion_min, 60)) > now()
  LOOP
    v_encuentros := v_encuentros + 1;
    v_encolados := 0;
    v_nombres := '';
    v_fecha_txt := to_char(v_enc.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
    v_hora_txt  := to_char(v_enc.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI');

    FOR v_al IN
      SELECT cm.id AS matricula_id, p.full_name, u.email
      FROM public.curso_matriculas cm
      JOIN public.profiles p ON p.id = cm.profile_id
      JOIN auth.users u ON u.id = p.id
      WHERE cm.curso_id = v_enc.curso_id
        AND cm.estado = 'activa'
        AND (cm.vigencia_hasta IS NULL OR cm.vigencia_hasta >= v_hoy)
        AND NOT EXISTS (
          SELECT 1
          FROM public.curso_encuentro_asistencias a
          JOIN public.curso_encuentros e2 ON e2.id = a.encuentro_id
          WHERE a.matricula_id = cm.id AND a.presente
            AND e2.condicion_id = v_enc.condicion_id
        )
        AND u.email IS NOT NULL
    LOOP
      -- 0412 (§6 DGG-131): dedupe también por SESIÓN — una persona matriculada
      -- en los 2 cursos espejo de la misma sesión recibía 2 mails idénticos.
      IF EXISTS (
        SELECT 1 FROM public.email_queue q
        WHERE q.related_table = 'curso_encuentros'
          AND q.to_email = lower(v_al.email)
          AND q.template_slug = 'campus-encuentro-recordatorio-dia'
          AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
          AND (
            q.related_id = v_enc.id
            OR (v_enc.sesion_id IS NOT NULL AND q.related_id IN (
                 SELECT e3.id FROM public.curso_encuentros e3
                  WHERE e3.sesion_compartida_id = v_enc.sesion_id
               ))
          )
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.email_queue
        (to_email, to_nombre, subject, kind, template_slug, variables,
         prioridad, programado_para, related_table, related_id)
      VALUES (
        lower(v_al.email), COALESCE(v_al.full_name, 'Alumno'),
        '¡HOY se dicta ' || v_enc.modulo || '! Te esperamos a las ' || v_hora_txt || ' · Gestión Global',
        'workflow', 'campus-encuentro-recordatorio-dia',
        jsonb_build_object(
          'nombre', COALESCE(v_al.full_name, 'Alumno'),
          'modulo', v_enc.modulo,
          'curso_titulo', v_enc.curso_titulo,
          'fecha', v_fecha_txt,
          'hora', v_hora_txt,
          'duracion', v_enc.duracion_min,
          'portal_url', 'https://gestionglobal.ar/portal/campus/' || COALESCE(v_enc.curso_slug, v_enc.curso_id::text)
        ),
        2, now(), 'curso_encuentros', v_enc.id
      );
      v_encolados := v_encolados + 1;
      v_nombres := v_nombres || '• ' || COALESCE(v_al.full_name, 'Alumno') || ' <' || v_al.email || '>' || E'\n';
    END LOOP;

    IF v_encolados > 0 THEN
      FOR v_ger IN
        SELECT u.email, p.full_name
        FROM public.profiles p JOIN auth.users u ON u.id = p.id
        WHERE p.role = 'gerente' AND p.activo = true AND u.email IS NOT NULL
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.email_queue q
          WHERE q.related_table = 'curso_encuentros' AND q.related_id = v_enc.id
            AND q.to_email = lower(v_ger.email)
            AND q.template_slug = 'gerencia-notif-generica'
            AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
        ) THEN
          INSERT INTO public.email_queue
            (to_email, to_nombre, subject, kind, template_slug, variables,
             prioridad, programado_para, related_table, related_id)
          VALUES (
            lower(v_ger.email), COALESCE(v_ger.full_name, 'Gerencia'),
            '[Testigo] Recordatorio de encuentro enviado · ' || v_enc.modulo || ' (' || v_fecha_txt || ')',
            'workflow', 'gerencia-notif-generica',
            jsonb_build_object(
              'titulo_evento', '[Testigo] Recordatorio de encuentro enviado',
              'url', '/gerencia/campus/' || v_enc.curso_id::text,
              'cuerpo',
                'Se envió el recordatorio automático del encuentro de HOY.' || E'\n\n' ||
                'Curso: ' || v_enc.curso_titulo || E'\n' ||
                'Asignatura: ' || v_enc.modulo || E'\n' ||
                'Encuentro: ' || v_enc.titulo || ' · ' || v_fecha_txt || ' ' || v_hora_txt || ' hs (' || v_enc.duracion_min || ' min)' || E'\n' ||
                'Destinatarios (' || v_encolados || ' alumno/s sin asistencia previa en el módulo):' || E'\n' || v_nombres
            ),
            2, now(), 'curso_encuentros', v_enc.id
          );
        END IF;
      END LOOP;
    END IF;

    v_total := v_total + v_encolados;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'fecha', v_hoy, 'encuentros_hoy', v_encuentros, 'mails_alumnos', v_total);
END;
$$;
