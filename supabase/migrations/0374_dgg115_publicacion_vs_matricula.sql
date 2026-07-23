-- 0374 · DGG-115 — Visibilidad ≠ Matrícula: ciclo de vida de publicación del curso
--
-- Decisiones de Pablo (2026-07-23): (1) matriculado con curso no publicado ve
-- card de expectativa SIN contenido; (2) al pasar despublicar_at el curso queda
-- FINALIZADO: corta matriculación de nuevos y visibilidad para no matriculados,
-- los matriculados conservan su vigencia individual (DGG-82); (3) matricular a
-- curso oculto: SOLO gerencia; el circuito público de forms no cambia; (4) un
-- finalizado sigue siendo duplicable (curso_duplicar ya lo cumple: clon nace
-- borrador con fechas NULL — verificado, sin cambios).
--
-- Modelo real (mapa 3 agentes): cursos NO tiene columna `publicado` — el flag
-- es `activo` + ventana publicar_at/despublicar_at (mig 0140). El estado es
-- DERIVADO (sin crons que sincronizar). Precedencia: finalizado > borrador >
-- programado > publicado (finalizado gana aunque el tilde esté apagado, porque
-- lo que define es el corte de matriculación).
--
-- Gaps que cierra (antes TODO el enforcement era visual, del lado del front):
--   a) RLS cursos: authenticated no-matriculado leía programados/finalizados
--      por API; matriculado PERDÍA la fila con activo=false (card rota +
--      skeleton eterno, E-GG-147).
--   b) RLS hijas: matriculado leía contenido de cursos NO publicados por API.
--   c) curso_asignar_alumno matriculaba a finalizados; curso_matricular
--      rechazaba ocultos (contradicción entre las dos vías de gerencia).
--   d) Recordatorio 8AM y banner del día disparaban para cursos no publicados.

-- ── 1) Helpers de estado (fuente única) ──────────────────────────────────
CREATE OR REPLACE FUNCTION private.curso_estado_publicacion(
  p_activo boolean, p_publicar_at timestamptz, p_despublicar_at timestamptz
) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN p_despublicar_at IS NOT NULL AND p_despublicar_at <= now() THEN 'finalizado'
    WHEN COALESCE(p_activo, false) = false THEN 'borrador'
    WHEN p_publicar_at IS NOT NULL AND p_publicar_at > now() THEN 'programado'
    ELSE 'publicado'
  END
$$;

CREATE OR REPLACE FUNCTION private.curso_estado_publicacion_id(p_curso_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at)
  FROM public.cursos c WHERE c.id = p_curso_id
$$;

-- Contenido accesible = matrícula vigente (DGG-82) Y curso publicado o
-- finalizado (el finalizado conserva acceso por decisión 2; borrador y
-- programado NO exponen contenido — solo la fila cursos para la card).
CREATE OR REPLACE FUNCTION private.curso_contenido_accesible(p_curso_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT private.curso_matriculado(p_curso_id)
     AND private.curso_estado_publicacion_id(p_curso_id) IN ('publicado','finalizado')
$$;

GRANT EXECUTE ON FUNCTION private.curso_estado_publicacion(boolean, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION private.curso_estado_publicacion_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.curso_contenido_accesible(uuid) TO authenticated;

-- Higiene detectada por el mapa: is_visible_for_alumno llama now() pero estaba
-- IMMUTABLE (riesgo de plan caching). Volatilidad correcta:
ALTER FUNCTION public.is_visible_for_alumno(boolean, timestamptz, timestamptz) STABLE;

-- ── 2) RLS cursos: matriculado SIEMPRE lee su fila; público solo publicados ─
DROP POLICY IF EXISTS cursos_select_auth ON public.cursos;
CREATE POLICY cursos_select_auth ON public.cursos
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(id)
    OR private.curso_estado_publicacion(activo, publicar_at, despublicar_at) = 'publicado'
  );

-- ── 3) RLS hijas: contenido solo con curso publicado/finalizado ──────────
DROP POLICY IF EXISTS curso_modulos_select ON public.curso_modulos;
CREATE POLICY curso_modulos_select ON public.curso_modulos
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_contenido_accesible(curso_id));

DROP POLICY IF EXISTS curso_bibliografia_select ON public.curso_bibliografia;
CREATE POLICY curso_bibliografia_select ON public.curso_bibliografia
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_contenido_accesible(curso_id));

DROP POLICY IF EXISTS curso_condiciones_select ON public.curso_condiciones_config;
CREATE POLICY curso_condiciones_select ON public.curso_condiciones_config
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_contenido_accesible(curso_id));

DROP POLICY IF EXISTS curso_encuentros_select ON public.curso_encuentros;
CREATE POLICY curso_encuentros_select ON public.curso_encuentros
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_contenido_accesible(curso_id));

DROP POLICY IF EXISTS curso_examenes_select ON public.curso_examenes;
CREATE POLICY curso_examenes_select ON public.curso_examenes
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_contenido_accesible(curso_id));

DROP POLICY IF EXISTS curso_clases_select ON public.curso_clases;
CREATE POLICY curso_clases_select ON public.curso_clases
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_contenido_accesible((
      SELECT m.curso_id FROM public.curso_modulos m WHERE m.id = curso_clases.modulo_id
    ))
  );

DROP POLICY IF EXISTS curso_examen_secciones_select ON public.curso_examen_secciones;
CREATE POLICY curso_examen_secciones_select ON public.curso_examen_secciones
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_contenido_accesible((
      SELECT e.curso_id FROM public.curso_examenes e WHERE e.id = curso_examen_secciones.examen_id
    ))
  );

DROP POLICY IF EXISTS curso_modulo_material_select ON public.curso_modulo_material;
CREATE POLICY curso_modulo_material_select ON public.curso_modulo_material
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_contenido_accesible((
      SELECT m.curso_id FROM public.curso_modulos m WHERE m.id = curso_modulo_material.modulo_id
    ))
  );

-- ── 4) Guard de finalizado en las DOS vías de matrícula de gerencia ──────
-- (misma firma → CREATE OR REPLACE seguro, R16)
CREATE OR REPLACE FUNCTION public.curso_asignar_alumno(
  p_curso_id uuid, p_administracion_id uuid, p_profile_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_matricula_id uuid;
  v_profile_id uuid;
  v_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede asignar alumnos a un curso' USING ERRCODE = '42501';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);
  -- DGG-115: borrador/programado/oculto SÍ se matriculan (privilegio de
  -- gerencia, pre-venta); FINALIZADO no admite nuevas matrículas.
  SELECT private.curso_estado_publicacion(activo, publicar_at, despublicar_at)
    INTO v_estado FROM public.cursos WHERE id = p_curso_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Curso inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'finalizado' THEN
    RAISE EXCEPTION 'El curso está finalizado; no admite nuevas matrículas' USING ERRCODE = '22023';
  END IF;
  v_profile_id := COALESCE(p_profile_id,
    (SELECT user_id FROM public.administraciones WHERE id = p_administracion_id));
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el profile_id (admin sin user vinculado y p_profile_id NULL)' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_matricula_id FROM public.curso_matriculas
    WHERE curso_id = p_curso_id AND administracion_id = p_administracion_id AND profile_id = v_profile_id;
  IF v_matricula_id IS NOT NULL THEN
    RETURN v_matricula_id;
  END IF;
  INSERT INTO public.curso_matriculas (curso_id, administracion_id, profile_id, fuente)
  VALUES (p_curso_id, p_administracion_id, v_profile_id, 'gerencia_manual')
  RETURNING id INTO v_matricula_id;
  RETURN v_matricula_id;
END $function$;

CREATE OR REPLACE FUNCTION public.curso_matricular(
  p_curso_id uuid, p_profile_id uuid, p_administracion_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso public.cursos%ROWTYPE; v_profile public.profiles%ROWTYPE;
  v_activas integer; v_matricula_id uuid; v_vigencia_hasta date; v_email text; v_nombre text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'La inscripcion la habilita la gerencia (acceso por asignacion)' USING ERRCODE = '42501';
  END IF;
  IF p_administracion_id IS NOT NULL THEN PERFORM private.assert_administracion_access(p_administracion_id); END IF;
  SELECT * INTO v_curso FROM public.cursos WHERE id = p_curso_id;
  IF v_curso.id IS NULL THEN RAISE EXCEPTION 'Curso no disponible' USING ERRCODE = '22023'; END IF;
  -- DGG-115: antes exigía activo=true (rechazaba ocultos, contradiciendo la
  -- otra vía de gerencia). Ahora el ÚNICO bloqueo es finalizado.
  IF private.curso_estado_publicacion(v_curso.activo, v_curso.publicar_at, v_curso.despublicar_at) = 'finalizado' THEN
    RAISE EXCEPTION 'El curso está finalizado; no admite nuevas matrículas' USING ERRCODE = '22023';
  END IF;
  IF v_curso.cupo_max IS NOT NULL THEN
    SELECT count(*) INTO v_activas FROM public.curso_matriculas
     WHERE curso_id = p_curso_id AND estado IN ('activa','completada');
    IF v_activas >= v_curso.cupo_max THEN
      RAISE EXCEPTION 'El curso "%" alcanzo su cupo (%/%)', v_curso.titulo, v_activas, v_curso.cupo_max USING ERRCODE = '53300';
    END IF;
  END IF;
  v_vigencia_hasta := (now() + (v_curso.vigencia_meses || ' months')::interval)::date;
  INSERT INTO public.curso_matriculas (curso_id, profile_id, administracion_id, vigencia_hasta, estado)
  VALUES (p_curso_id, p_profile_id, p_administracion_id, v_vigencia_hasta, 'activa')
  ON CONFLICT (curso_id, profile_id) DO UPDATE
    SET estado = CASE WHEN public.curso_matriculas.estado = 'anulada' THEN 'activa' ELSE public.curso_matriculas.estado END,
        vigencia_hasta = EXCLUDED.vigencia_hasta,
        administracion_id = COALESCE(EXCLUDED.administracion_id, public.curso_matriculas.administracion_id),
        updated_at = now()
  RETURNING id INTO v_matricula_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
  v_email := (SELECT email FROM auth.users WHERE id = p_profile_id);
  v_nombre := COALESCE(v_profile.full_name, 'Alumno');
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email('curso-inscripcion-confirmada', v_email, v_nombre,
      jsonb_build_object('nombre', v_nombre, 'curso_titulo', v_curso.titulo, 'nombre_curso', v_curso.titulo,
        'vigencia_hasta', to_char(v_vigencia_hasta, 'DD/MM/YYYY'),
        'fecha_inicio', to_char(COALESCE(v_curso.fecha_inicio, CURRENT_DATE), 'DD/MM/YYYY')),
      p_administracion_id, NULL, 'curso_matriculas', v_matricula_id, 5::smallint);
  END IF;
  RETURN v_matricula_id;
END; $function$;

-- ── 5) Banner del día y recordatorio 8AM: solo cursos publicados/finalizados ─
CREATE OR REPLACE FUNCTION public.alumno_encuentros_hoy()
 RETURNS TABLE(encuentro_id uuid, encuentro_titulo text, modulo text, curso_titulo text, curso_slug text, fecha_hora timestamp with time zone, duracion_min integer, plataforma text, join_url text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- DGG-115: un curso en borrador/programado no filtra sus clases al banner.
    AND private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at)
        IN ('publicado','finalizado')
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
$function$;

CREATE OR REPLACE FUNCTION public.gg_encuentros_recordatorio_diario()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- DGG-115: nunca recordar clases de cursos en borrador/programado.
      AND private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at)
          IN ('publicado','finalizado')
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
$function$;
