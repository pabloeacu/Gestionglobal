-- ============================================================================
-- 0376 · DGG-115b · Aviso automático "tu curso ya está disponible"
--
-- Cierra el hallazgo C#15 de la auditoría §6 de DGG-115: los matriculados en
-- pre-venta ven la card de expectativa, pero nadie les avisaba activamente
-- cuando el curso pasa a 'publicado' (el estado es DERIVADO — no hay trigger
-- posible en la transición). Vía elegida: cron horario que detecta cursos en
-- estado 'publicado' sin marca de notificación y avisa por email + push web a
-- los matriculados activos, con testigo a gerencia.
--
-- Diseño:
--  · `cursos.publicado_notificado_at` = marca de "ya se avisó" (una vez por
--    vida del curso; re-publicar tras ocultar NO re-avisa).
--  · BACKFILL: los cursos HOY en estado publicado o finalizado se marcan al
--    aplicar la mig — sus alumnos ya conocen el curso (nunca spamear a los
--    matriculados reales existentes).
--  · Solo notifica la transición a 'publicado'. Un curso que salta directo a
--    'finalizado' sin publicarse (ventana invertida, warned en la UI) no
--    dispara el aviso — "ya está disponible" sería falso.
--  · Idempotente doble: marca por curso + dedupe por alumno en email_queue
--    (template+curso+email, all-time).
--  · Push: INSERT directo en push_notifications_queue (encolar_push exige
--    auth.uid()/staff y el cron corre como postgres); la drena el job 9
--    (dispatch-push cada 2 min). Sin suscripción push del alumno, el insert
--    queda sin destino y no molesta.
--  · Cron: `SELECT public.gg_cursos_publicados_notificar();` horario (patrón
--    de los jobs 11/12/13/20/22 — SQL directo, sin GUCs; regla E-GG-146: la
--    primera corrida real se verifica en cron.job_run_details).
-- ============================================================================

-- ── 1 · Columna + backfill ───────────────────────────────────────────────────
ALTER TABLE public.cursos ADD COLUMN IF NOT EXISTS publicado_notificado_at timestamptz;
COMMENT ON COLUMN public.cursos.publicado_notificado_at IS
  'DGG-115b: cuándo se avisó a los matriculados que el curso quedó publicado. NULL = pendiente (el cron horario avisa al detectar estado publicado). Columna AUTO (R14): la setea el cron, sin editor de UI.';

UPDATE public.cursos
SET publicado_notificado_at = now()
WHERE publicado_notificado_at IS NULL
  AND private.curso_estado_publicacion(activo, publicar_at, despublicar_at)
      IN ('publicado','finalizado');

-- ── 2 · Template del email ───────────────────────────────────────────────────
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, activo, kicker, titulo_visual,
   color_acento, mostrar_logo, cuerpo_html_visual, firma, layout_version,
   cta_text, cta_url, descripcion, variables)
VALUES (
  'campus-curso-publicado',
  'Campus · Tu curso ya está disponible',
  '¡Ya podés empezar {{curso_titulo}}! · Gestión Global',
  '<!-- manaxer-v1 -->',
  'general', true,
  'TU CURSO YA ESTÁ DISPONIBLE',
  '¡Llegó el día, {{nombre}}!',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">El contenido de <strong>«{{curso_titulo}}»</strong> ya está habilitado en tu campus. Tu matrícula estaba lista — ahora también lo está el curso. 🎉</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Entrá al portal, abrí la sección <strong>Campus</strong> y vas a encontrar tus clases, materiales y todo lo necesario para arrancar.</p>' ||
  '<p style="margin:0;color:#1e293b;">Te esperamos — ¡buen comienzo! 💪</p>',
  'Equipo Campus · Gestión Global', 'manaxer-v1',
  'Ir a mi curso', '{{portal_url}}',
  'Se envía automáticamente (cron horario) a los matriculados activos cuando su curso pasa a estado publicado (DGG-115b). Una sola vez por curso.',
  '["nombre","curso_titulo","portal_url"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── 3 · Función del cron ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gg_cursos_publicados_notificar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_curso record;
  v_al record;
  v_ger record;
  v_encolados int;
  v_total int := 0;
  v_cursos int := 0;
  v_nombres text;
  v_url text;
BEGIN
  FOR v_curso IN
    SELECT c.id, c.titulo, c.slug
    FROM public.cursos c
    WHERE c.publicado_notificado_at IS NULL
      AND private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at) = 'publicado'
  LOOP
    v_cursos := v_cursos + 1;
    v_encolados := 0;
    v_nombres := '';
    v_url := 'https://gestionglobal.ar/portal/campus/' || COALESCE(v_curso.slug, v_curso.id::text);

    FOR v_al IN
      SELECT cm.profile_id, cm.administracion_id, p.full_name, u.email
      FROM public.curso_matriculas cm
      JOIN public.profiles p ON p.id = cm.profile_id
      JOIN auth.users u ON u.id = p.id
      WHERE cm.curso_id = v_curso.id
        AND cm.estado = 'activa'
        AND (cm.vigencia_hasta IS NULL OR cm.vigencia_hasta >= v_hoy)
        AND u.email IS NOT NULL
    LOOP
      -- Dedupe por alumno (all-time): un solo aviso por curso+destinatario.
      IF EXISTS (
        SELECT 1 FROM public.email_queue q
        WHERE q.related_table = 'cursos' AND q.related_id = v_curso.id
          AND q.to_email = lower(v_al.email)
          AND q.template_slug = 'campus-curso-publicado'
      ) THEN
        CONTINUE;
      END IF;

      PERFORM public.encolar_email(
        'campus-curso-publicado',
        v_al.email,
        COALESCE(v_al.full_name, 'Alumno'),
        jsonb_build_object(
          'nombre', COALESCE(v_al.full_name, 'Alumno'),
          'curso_titulo', v_curso.titulo,
          'portal_url', v_url
        ),
        v_al.administracion_id, NULL, 'cursos', v_curso.id, 3::smallint
      );

      -- Push web (best-effort: sin suscripción no llega a nadie y no molesta).
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (
        v_al.profile_id,
        '¡Tu curso ya está disponible!',
        'El contenido de «' || v_curso.titulo || '» quedó habilitado en tu campus.',
        v_url
      );

      v_encolados := v_encolados + 1;
      v_nombres := v_nombres || '• ' || COALESCE(v_al.full_name, 'Alumno') || ' <' || v_al.email || '>' || E'\n';
    END LOOP;

    -- Testigo a gerencia (solo si hubo destinatarios).
    IF v_encolados > 0 THEN
      FOR v_ger IN
        SELECT u.email, p.full_name
        FROM public.profiles p JOIN auth.users u ON u.id = p.id
        WHERE p.role = 'gerente' AND p.activo = true AND u.email IS NOT NULL
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.email_queue q
          WHERE q.related_table = 'cursos' AND q.related_id = v_curso.id
            AND q.to_email = lower(v_ger.email)
            AND q.template_slug = 'gerencia-notif-generica'
            AND q.subject LIKE '[Testigo] Curso publicado%'
        ) THEN
          INSERT INTO public.email_queue
            (to_email, to_nombre, subject, kind, template_slug, variables,
             prioridad, programado_para, related_table, related_id)
          VALUES (
            lower(v_ger.email), COALESCE(v_ger.full_name, 'Gerencia'),
            '[Testigo] Curso publicado · aviso enviado a los matriculados · ' || v_curso.titulo,
            'workflow', 'gerencia-notif-generica',
            jsonb_build_object(
              'titulo_evento', '[Testigo] Aviso de curso publicado enviado',
              'url', '/gerencia/campus/' || v_curso.id::text,
              'cuerpo',
                'El curso pasó a PUBLICADO y se avisó automáticamente a sus matriculados.' || E'\n\n' ||
                'Curso: ' || v_curso.titulo || E'\n' ||
                'Destinatarios (' || v_encolados || ' alumno/s con matrícula activa):' || E'\n' || v_nombres
            ),
            3, now(), 'cursos', v_curso.id
          );
        END IF;
      END LOOP;
    END IF;

    -- Marca SIEMPRE (aunque 0 destinatarios): la transición ya fue vista.
    UPDATE public.cursos SET publicado_notificado_at = now() WHERE id = v_curso.id;
    v_total := v_total + v_encolados;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cursos_notificados', v_cursos, 'mails_alumnos', v_total);
END;
$$;

-- Mass-mailer: nadie lo ejecuta salvo el cron (postgres/owner). Sin GRANTs.
REVOKE ALL ON FUNCTION public.gg_cursos_publicados_notificar() FROM PUBLIC, anon, authenticated;

-- ── 4 · Cron horario ─────────────────────────────────────────────────────────
SELECT cron.schedule(
  'gg-cursos-publicados-notificar',
  '12 * * * *',
  'SELECT public.gg_cursos_publicados_notificar();'
);
