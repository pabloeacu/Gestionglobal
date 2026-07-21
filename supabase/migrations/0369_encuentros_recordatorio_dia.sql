-- 0369 · DGG-112 · Recordatorio automático del día del encuentro sincrónico
-- (decisiones Pablo 2026-07-21):
--  · Mail 8:00 AM (hora AR) del día de CADA encuentro de un módulo con
--    asistencia OBLIGATORIA, a todo alumno matriculado (activa + vigencia
--    no vencida) que aún NO asistió a NINGUNA fecha alternativa del módulo
--    (módulo de encuentro único: misma lógica). Se repite en cada fecha
--    hasta que asista. Queda en email_queue → sent_emails (registro).
--  · Copia testigo a TODOS los gerentes activos (dinámico).
--  · RPC para el banner del día en el portal del alumno (00:00 → fin de la
--    clase = inicio + duración).
--  · Limpieza: condición residual de QA en el curso de Formación PBA.

-- ── 0 · Residuo QA (sobrevivió a DGG-111 por vivir en el catálogo) ───────────
UPDATE public.curso_encuentros SET condicion_id = NULL
WHERE condicion_id = '7b0f6b5b-f270-4e10-8d76-cf04d12329da';
DELETE FROM public.matricula_condiciones
WHERE condicion_id = '7b0f6b5b-f270-4e10-8d76-cf04d12329da';
DELETE FROM public.curso_condiciones_config
WHERE id = '7b0f6b5b-f270-4e10-8d76-cf04d12329da';

-- ── 1 · Template del mail al alumno ──────────────────────────────────────────
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, activo, kicker, titulo_visual,
   color_acento, mostrar_logo, cuerpo_html_visual, firma, layout_version,
   cta_text, cta_url, descripcion, variables)
VALUES (
  'campus-encuentro-recordatorio-dia',
  'Campus · Recordatorio: HOY se dicta tu clase sincrónica',
  '¡HOY se dicta {{modulo}}! Te esperamos a las {{hora}} · Gestión Global',
  '<!-- manaxer-v1 -->',
  'general', true,
  'TU CLASE ES HOY',
  '¡Hoy tenés clase, {{nombre}}!',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">¡Llegó el día! <strong>HOY se dicta la asignatura «{{modulo}}»</strong> del {{curso_titulo}}.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  '🕕 <strong>{{fecha}} · {{hora}} hs</strong> (duración: {{duracion}} min) · modalidad online en vivo.</p>' ||
  '<p style="margin:0 0 12px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 14px;color:#92400e;">' ||
  '<strong>Tu asistencia es obligatoria</strong>: es una de las condiciones para la aprobación del curso. ¡No te la pierdas!</p>' ||
  '<p style="margin:0 0 6px;color:#1e293b;"><strong>¿Cómo entrar?</strong> Es muy fácil:</p>' ||
  '<ol style="margin:0 0 12px;padding-left:20px;color:#334155;">' ||
  '<li>Ingresá al portal con tu usuario (botón de abajo).</li>' ||
  '<li>Abrí tu curso en la sección <strong>Campus</strong>.</li>' ||
  '<li>Andá a <strong>Encuentros sincrónicos</strong> y tocá <strong>Unirse a la clase</strong> a la hora indicada.</li></ol>' ||
  '<p style="margin:0;color:#1e293b;">Te esperamos — tu presencia hace la diferencia. 💪</p>',
  'Equipo Campus · Gestión Global', 'manaxer-v1',
  'Entrar al campus', '{{portal_url}}',
  'Se envía automáticamente a las 8:00 (AR) del día de cada encuentro sincrónico obligatorio, a los alumnos que aún no asistieron a ninguna fecha del módulo (DGG-112).',
  '["nombre","modulo","curso_titulo","fecha","hora","duracion","portal_url"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── 2 · RPC del cron diario ──────────────────────────────────────────────────
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
    SELECT ce.id, ce.titulo, ce.fecha_hora, COALESCE(ce.duracion_min, 60) AS duracion_min,
           ce.condicion_id, ccc.etiqueta AS modulo,
           c.id AS curso_id, c.titulo AS curso_titulo, c.slug AS curso_slug
    FROM public.curso_encuentros ce
    JOIN public.curso_condiciones_config ccc ON ccc.id = ce.condicion_id
    JOIN public.cursos c ON c.id = ce.curso_id
    WHERE (ce.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy
      AND ccc.obligatoria AND ccc.activa
      -- si la clase ya terminó (re-corrida manual tarde), no avisar
      AND ce.fecha_hora + make_interval(mins => COALESCE(ce.duracion_min, 60)) > now()
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
        -- sin asistencia en NINGUNA fecha (alternativa o única) del módulo
        AND NOT EXISTS (
          SELECT 1
          FROM public.curso_encuentro_asistencias a
          JOIN public.curso_encuentros e2 ON e2.id = a.encuentro_id
          WHERE a.matricula_id = cm.id AND a.presente
            AND e2.condicion_id = v_enc.condicion_id
        )
        AND u.email IS NOT NULL
    LOOP
      -- idempotencia: si el cron re-corre HOY, no duplicar
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

    -- copia testigo a todos los gerentes activos (solo si hubo envíos)
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

REVOKE ALL ON FUNCTION public.gg_encuentros_recordatorio_diario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_encuentros_recordatorio_diario() TO service_role;

-- ── 3 · RPC del banner del día (portal del alumno) ───────────────────────────
-- Mismo universo que el mail; visible desde las 00:00 del día del encuentro
-- hasta inicio + duración. Scoped a auth.uid(): cada alumno ve solo lo suyo.
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
         ce.fecha_hora, COALESCE(ce.duracion_min, 60),
         COALESCE(ce.plataforma, 'zoom'),
         CASE WHEN COALESCE(ce.plataforma, 'zoom') = 'webex'
              THEN ce.webex_join_url ELSE ce.zoom_join_url END
  FROM public.curso_encuentros ce
  JOIN public.curso_condiciones_config ccc ON ccc.id = ce.condicion_id
  JOIN public.cursos c ON c.id = ce.curso_id
  JOIN public.curso_matriculas cm
    ON cm.curso_id = ce.curso_id AND cm.profile_id = auth.uid()
  WHERE ccc.obligatoria AND ccc.activa
    AND cm.estado = 'activa'
    AND (cm.vigencia_hasta IS NULL
         OR cm.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
    AND (ce.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    AND ce.fecha_hora + make_interval(mins => COALESCE(ce.duracion_min, 60)) > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.curso_encuentro_asistencias a
      JOIN public.curso_encuentros e2 ON e2.id = a.encuentro_id
      WHERE a.matricula_id = cm.id AND a.presente
        AND e2.condicion_id = ce.condicion_id
    )
  ORDER BY ce.fecha_hora;
$$;

REVOKE ALL ON FUNCTION public.alumno_encuentros_hoy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alumno_encuentros_hoy() TO authenticated;

-- ── 4 · Cron diario 8:00 AR (= 11:00 UTC) ────────────────────────────────────
SELECT cron.schedule(
  'gg-encuentros-recordatorio-diario',
  '0 11 * * *',
  'SELECT public.gg_encuentros_recordatorio_diario();'
);
