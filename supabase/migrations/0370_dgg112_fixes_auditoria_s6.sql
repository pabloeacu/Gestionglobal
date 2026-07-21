-- 0370 · DGG-112 · fixes de la doble auditoría §6:
-- (a) CRÍTICO latente: las 2 RPCs leían fecha/duración/plataforma/sala directo
--     de curso_encuentros, pero en encuentros COMPARTIDOS (DGG-79/F11) la
--     verdad única vive en encuentro_sesiones_compartidas (la fila del curso
--     queda stale y su sala en NULL). LEFT JOIN + COALESCE en filtro de día,
--     gate de fin de clase, variables del mail y join_url del banner.
-- (b) MENOR: el mail testigo no pasaba la variable {{url}} del template
--     gerencia-notif-generica → el CTA quedaba a la landing. Ahora linkea al
--     curso en el panel de gerencia.
-- Misma firma en ambas RPCs → CREATE OR REPLACE sin overload (R16).

CREATE OR REPLACE FUNCTION public.gg_encuentros_recordatorio_diario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
           c.id AS curso_id, c.titulo AS curso_titulo, c.slug AS curso_slug
    FROM public.curso_encuentros ce
    LEFT JOIN public.encuentro_sesiones_compartidas s ON s.id = ce.sesion_compartida_id
    JOIN public.curso_condiciones_config ccc ON ccc.id = ce.condicion_id
    JOIN public.cursos c ON c.id = ce.curso_id
    WHERE (COALESCE(s.fecha_hora, ce.fecha_hora) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
      AND ccc.obligatoria AND ccc.activa
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
      IF EXISTS (
        SELECT 1 FROM public.email_queue q
        WHERE q.related_table = 'curso_encuentros' AND q.related_id = v_enc.id
          AND q.to_email = lower(v_al.email)
          AND q.template_slug = 'campus-encuentro-recordatorio-dia'
          AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
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

CREATE OR REPLACE FUNCTION public.alumno_encuentros_hoy()
RETURNS TABLE (
  encuentro_id uuid, encuentro_titulo text, modulo text,
  curso_titulo text, curso_slug text,
  fecha_hora timestamptz, duracion_min int,
  plataforma text, join_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ce.id, ce.titulo, ccc.etiqueta,
         c.titulo, c.slug,
         COALESCE(s.fecha_hora, ce.fecha_hora),
         COALESCE(s.duracion_min, ce.duracion_min, 60),
         COALESCE(s.plataforma, ce.plataforma, 'zoom'),
         CASE WHEN COALESCE(s.plataforma, ce.plataforma, 'zoom') = 'webex'
              THEN COALESCE(ce.webex_join_url, s.webex_join_url)
              ELSE COALESCE(ce.zoom_join_url, s.zoom_join_url) END
  FROM public.curso_encuentros ce
  LEFT JOIN public.encuentro_sesiones_compartidas s ON s.id = ce.sesion_compartida_id
  JOIN public.curso_condiciones_config ccc ON ccc.id = ce.condicion_id
  JOIN public.cursos c ON c.id = ce.curso_id
  JOIN public.curso_matriculas cm
    ON cm.curso_id = ce.curso_id AND cm.profile_id = auth.uid()
  WHERE ccc.obligatoria AND ccc.activa
    AND cm.estado = 'activa'
    AND (cm.vigencia_hasta IS NULL
         OR cm.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
    AND (COALESCE(s.fecha_hora, ce.fecha_hora) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    AND COALESCE(s.fecha_hora, ce.fecha_hora)
        + make_interval(mins => COALESCE(s.duracion_min, ce.duracion_min, 60)) > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.curso_encuentro_asistencias a
      JOIN public.curso_encuentros e2 ON e2.id = a.encuentro_id
      WHERE a.matricula_id = cm.id AND a.presente
        AND e2.condicion_id = ce.condicion_id
    )
  ORDER BY 6;
$$;
