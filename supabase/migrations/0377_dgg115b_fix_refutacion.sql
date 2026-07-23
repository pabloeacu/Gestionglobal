-- ============================================================================
-- 0377 · DGG-115b · Fixes de la refutación adversarial (E-GG-149)
--
-- Los 2 refutadores §6 voltearon la v1 del aviso "curso publicado" (mig 0376):
--
--  1. [CRÍTICO — probado e2e por ambos] La función llamaba a
--     public.encolar_email(...administracion_id...) y esa RPC ejecuta
--     private.assert_administracion_access (hardening 0350). Bajo pg_cron
--     (postgres, sin JWT) el assert revienta con 42501 apenas la matrícula
--     tenga administracion_id — y HOY el 100% de las matrículas activas
--     reales lo tienen. La primera publicación real habría fallado cada hora
--     EN SILENCIO (transacción atómica: sin mails, sin push, sin marca, sin
--     alerta), con el cron reportando "succeeded" solo en corridas vacías.
--     Clase E-GG-42/E-GG-129: mi e2e v1 no lo vio porque las matrículas QA
--     iban SIN administración. Fix: INSERT directo a email_queue (patrón del
--     cron hermano 0369) — cero dependencia de encolar_email.
--  2. [CRÍTICO lateral, pre-existente 0024] encolar_email es ejecutable por
--     cualquier authenticated y con p_administracion_id=NULL saltea el
--     assert: permite disparar cualquier template a cualquier email y
--     ENVENENAR el dedupe de email_queue (suprimiendo el aviso real de un
--     alumno). No se puede revocar a ciegas (callers legítimos del front de
--     gerencia + RPCs + flujos públicos): el hardening es tarea aparte. Acá
--     se elimina la superficie: el cron ya no usa encolar_email NI dedupe
--     por email_queue — la ATOMICIDAD marca+mails (misma transacción) es la
--     garantía de envío único; un dedupe envenenable era peor que ninguno.
--  3. [GAP de flujo] crearCurso insertaba activo=true → el curso nacía
--     'publicado' vacío, el cron le quemaba la marca con 0 matriculados y la
--     pre-venta posterior quedaba SIN aviso. Fix front (mismo commit): los
--     cursos nacen en borrador (coherente con DGG-115). Acá además se
--     LIMPIAN las marcas quemadas de cursos publicados sin matrículas... no:
--     el backfill 0376 marcó los 2 publicados reales (con historia previa) a
--     propósito; no hay marcas quemadas que limpiar hoy (verificado: los 2
--     sin marca son borradores). Sin acción de datos.
--  4. [Menores] filtro p.activo=true en el loop de alumnos (no avisar a
--     perfiles dados de baja); guard de template inactivo (retorna warning
--     en vez de encolar contra un template muerto); advisory lock por si la
--     función se ejecuta a mano durante una corrida del cron; emails
--     normalizados a lower() (consistencia con 0369).
--
-- Residuales documentados (pre-existentes, fuera de alcance): renderVars
-- escapea HTML también en el subject (afecta a TODOS los templates si un
-- título tuviera &/<); mezcla apex/www en URLs generadas (compartido con
-- 0304); ventana de minutos entre encolado y despacho si gerencia oculta el
-- curso justo después de publicarlo.
-- ============================================================================

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
  -- Corridas solapadas (cron + ejecución manual): la segunda se retira.
  IF NOT pg_try_advisory_xact_lock(hashtext('gg_cursos_publicados_notificar')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'lock');
  END IF;

  -- Template muerto: avisar en el retorno del job en vez de encolar en vano.
  IF NOT EXISTS (
    SELECT 1 FROM public.email_templates
    WHERE slug = 'campus-curso-publicado' AND activo
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_inactivo');
  END IF;

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
        AND p.activo = true
        AND u.email IS NOT NULL
    LOOP
      -- E-GG-149: INSERT directo (patrón 0369) — encolar_email bajo pg_cron
      -- revienta en assert_administracion_access. Sin dedupe por email_queue:
      -- la marca del curso + la atomicidad de esta transacción garantizan un
      -- solo envío, y un dedupe sobre tabla alcanzable por encolar_email(NULL)
      -- era envenenable para SUPRIMIR avisos reales.
      INSERT INTO public.email_queue
        (to_email, to_nombre, subject, kind, template_slug, variables,
         prioridad, programado_para, related_table, related_id, administracion_id)
      VALUES (
        lower(v_al.email), COALESCE(v_al.full_name, 'Alumno'),
        '¡Ya podés empezar ' || v_curso.titulo || '! · Gestión Global',
        'workflow', 'campus-curso-publicado',
        jsonb_build_object(
          'nombre', COALESCE(v_al.full_name, 'Alumno'),
          'curso_titulo', v_curso.titulo,
          'portal_url', v_url
        ),
        3, now(), 'cursos', v_curso.id, v_al.administracion_id
      );

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

    IF v_encolados > 0 THEN
      FOR v_ger IN
        SELECT u.email, p.full_name
        FROM public.profiles p JOIN auth.users u ON u.id = p.id
        WHERE p.role = 'gerente' AND p.activo = true AND u.email IS NOT NULL
      LOOP
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
      END LOOP;
    END IF;

    UPDATE public.cursos SET publicado_notificado_at = now() WHERE id = v_curso.id;
    v_total := v_total + v_encolados;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cursos_notificados', v_cursos, 'mails_alumnos', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.gg_cursos_publicados_notificar() FROM PUBLIC, anon, authenticated;
