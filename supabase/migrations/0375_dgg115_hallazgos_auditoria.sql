-- ============================================================================
-- 0375 · DGG-115 — cierre de hallazgos de la doble auditoría §6 (agentes A y C)
--
--  1. [C#5 CRÍTICO] cliente_portal_dashboard.clase_hoy no filtraba publicación:
--     la HotCard del portal anunciaba la clase de un curso oculto/borrador y el
--     payload filtraba link_zoom + encuentro_id crudos por API (side-channel
--     del gate DGG-115: la RLS de curso_encuentros los esconde, el RPC
--     SECURITY DEFINER los regalaba). Fix: mismo criterio que
--     alumno_encuentros_hoy (estado IN publicado/finalizado).
--  2. [A#7] curso_examen_rendir gateaba matrícula pero NO publicación: un
--     matriculado en pre-venta (curso oculto) podía bajar el examen completo
--     por API con el examen_id. Fix: private.curso_contenido_accesible.
--  3. [C#2] gg_encuentros_recordatorio_diario (cron 8AM) excluía cursos
--     'programado' aunque se publicaran ANTES de la clase → el mail del primer
--     día jamás salía (el curso se publica 10:00, la clase es 19:00). Fix:
--     aceptar también programado cuando publicar_at <= fecha_hora del
--     encuentro.
--  4. [C#14] curso_matricular: el email de confirmación en pre-venta sin
--     fecha_inicio decía "inicio HOY" (COALESCE con CURRENT_DATE). Fix: en no
--     publicado usa publicar_at (fecha AR) o "a confirmar".
--
-- Sin cambios de firma en ninguna función (CREATE OR REPLACE seguro, R16 ok).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cliente_portal_dashboard — filtro de publicación en v_clase_hoy
--    (cuerpo = definición viva; el ÚNICO cambio es el AND de estado)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_admin record;
  v_deuda record;
  v_clase_hoy jsonb;
  v_webinar_proximo jsonb;
  v_ultimo_tramite jsonb;
  v_tramites_abiertos int;
  v_cursos_activos jsonb;
  v_vencimientos_proximos jsonb;
  v_oportunidades jsonb := '[]'::jsonb;
  v_cands jsonb := '[]'::jsonb;
  v_has_matricula boolean;
  v_matriculado boolean;
  v_ddjj_presentada boolean;
  v_tiene_deuda boolean;
  v_recien_llegado boolean;
  v_puede_crosssell boolean;            -- DGG-45r · gate de cross-sell suave
  v_dias_a_renovacion int;
  v_tiene_actualizacion_este_anio boolean;
  v_proxima_ddjj record;
  v_webinar_destacado record;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  SELECT id, codigo, nombre, responsable_nombre, responsable_apellido,
         matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_vencimiento, foto_url, created_at
    INTO v_admin
  FROM public.administraciones
  WHERE id = v_admin_id;

  v_has_matricula := v_admin.matricula_rpac IS NOT NULL;

  v_matriculado := v_has_matricula OR EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id
      AND t.estado = 'cerrado'
      AND s.nombre ILIKE 'Inscripción al RPAC%'
  );

  v_dias_a_renovacion := CASE
    WHEN v_admin.matricula_rpac_vencimiento IS NULL THEN NULL
    ELSE (v_admin.matricula_rpac_vencimiento - CURRENT_DATE)::int
  END;

  SELECT * INTO v_deuda FROM public.cliente_deuda_neta(v_admin_id);

  -- DGG-45r · gates de cross-sell
  v_tiene_deuda    := COALESCE(v_deuda.total, 0) > 0;
  v_recien_llegado := (now() - v_admin.created_at) < interval '15 days';
  v_puede_crosssell := (NOT v_tiene_deuda) AND (NOT v_recien_llegado);

  SELECT jsonb_build_object(
    'encuentro_id', e.id, 'curso_id', c.id, 'curso_slug', c.slug,
    'curso_titulo', c.titulo, 'encuentro_titulo', e.titulo, 'fecha_hora', e.fecha_hora,
    'minutos_para_inicio', EXTRACT(EPOCH FROM (e.fecha_hora - now()))::int / 60,
    'duracion_min', e.duracion_min,
    'link_zoom', COALESCE(e.zoom_join_url, e.link_zoom),
    'link_webex', e.webex_join_url,
    'plataforma', COALESCE(e.plataforma, 'zoom'), 'iniciado_at', e.iniciado_at
  ) INTO v_clase_hoy
  FROM public.curso_encuentros e
  JOIN public.cursos c ON c.id = e.curso_id
  WHERE EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.curso_id = c.id AND cm.estado = 'activa' AND p.administracion_id = v_admin_id
  )
    -- DGG-115 (0375): la HotCard solo anuncia clases de cursos visibles para
    -- el alumno — mismo criterio que alumno_encuentros_hoy.
    AND private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at)
        IN ('publicado','finalizado')
    AND e.fecha_hora BETWEEN (now() - interval '30 minutes') AND (now() + interval '12 hours')
  ORDER BY e.fecha_hora ASC LIMIT 1;

  SELECT jsonb_build_object(
    'webinar_id', w.id, 'titulo', w.titulo, 'fecha_hora', w.fecha_hora,
    'horas_para_inicio', EXTRACT(EPOCH FROM (w.fecha_hora - now())) / 3600,
    'plataforma', w.plataforma,
    'link', COALESCE(w.zoom_join_url, w.webex_join_url, w.youtube_live_url),
    'status', w.status, 'inscripto', true
  ) INTO v_webinar_proximo
  FROM public.webinars w
  JOIN public.webinar_inscriptos wi ON wi.webinar_id = w.id
  WHERE wi.administracion_id = v_admin_id
    AND w.fecha_hora >= now() - interval '15 minutes'
    AND w.status IN ('programado','en_curso')
  ORDER BY w.fecha_hora ASC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'matricula_id', cm.id, 'curso_id', c.id, 'curso_slug', c.slug,
    'curso_titulo', c.titulo, 'modalidad', c.modalidad,
    'vigencia_hasta', cm.vigencia_hasta, 'inscripto_at', cm.inscripto_at,
    'banner_url', c.banner_url
  ) ORDER BY cm.inscripto_at DESC), '[]'::jsonb)
  INTO v_cursos_activos
  FROM public.curso_matriculas cm
  JOIN public.cursos c ON c.id = cm.curso_id
  JOIN public.profiles p ON p.id = cm.profile_id
  WHERE p.administracion_id = v_admin_id AND cm.estado = 'activa';

  SELECT COUNT(*) INTO v_tramites_abiertos
  FROM public.tramites
  WHERE administracion_id = v_admin_id
    AND estado IN ('abierto','en_progreso','esperando_cliente');

  SELECT jsonb_build_object(
    'id', t.id, 'codigo', t.codigo, 'titulo', t.titulo, 'categoria', t.categoria,
    'estado', t.estado, 'ultima_actividad_at', t.ultima_actividad_at,
    'horas_desde_actividad', EXTRACT(EPOCH FROM (now() - t.ultima_actividad_at)) / 3600
  ) INTO v_ultimo_tramite
  FROM public.tramites t
  WHERE t.administracion_id = v_admin_id
    AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ORDER BY t.ultima_actividad_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', v.id, 'tipo', v.tipo, 'descripcion', v.descripcion,
    'fecha_vencimiento', v.fecha_vencimiento,
    'dias_restantes', (v.fecha_vencimiento - CURRENT_DATE)::int,
    'estado', v.estado, 'consorcio_id', v.consorcio_id, 'sujeto', v.sujeto
  ) ORDER BY v.fecha_vencimiento ASC), '[]'::jsonb)
  INTO v_vencimientos_proximos
  FROM (
    SELECT * FROM public.vencimientos
    WHERE administracion_id = v_admin_id AND estado = 'vigente'
      AND fecha_vencimiento BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '90 days')
    ORDER BY fecha_vencimiento ASC LIMIT 5
  ) v;

  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE p.administracion_id = v_admin_id
      AND c.slug ILIKE '%actualizacion%'
      AND cm.inscripto_at >= date_trunc('year', now())
  ) INTO v_tiene_actualizacion_este_anio;

  SELECT id, fecha_vencimiento, (fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes
    INTO v_proxima_ddjj
  FROM public.vencimientos
  WHERE administracion_id = v_admin_id AND tipo = 'ddjj_anual' AND estado = 'vigente'
    AND fecha_vencimiento >= CURRENT_DATE
  ORDER BY fecha_vencimiento ASC LIMIT 1;

  SELECT w.id, w.titulo, w.fecha_hora, w.descripcion INTO v_webinar_destacado
  FROM public.webinars w
  WHERE w.status = 'programado' AND w.fecha_hora >= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.webinar_inscriptos wi
      WHERE wi.webinar_id = w.id AND wi.administracion_id = v_admin_id
    )
  ORDER BY w.fecha_hora ASC LIMIT 1;

  v_ddjj_presentada := EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id
      AND s.nombre ILIKE 'Declaraciones juradas%'
      AND t.created_at >= date_trunc('year', now())
  );

  -- ====================== DGG-45 · MOTOR DE BANNERS ========================
  -- ACCIÓN / OBLIGACIÓN (no posponibles, no se suprimen por deuda/gracia)
  IF v_proxima_ddjj.dias_restantes IS NOT NULL AND v_proxima_ddjj.dias_restantes BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','ddjj_proxima','prioridad',10,'bucket','accion','posponible',false,
      'kicker','OBLIGACIÓN ANUAL','titulo','Tu DDJJ vence pronto',
      'descripcion','Tenés '||v_proxima_ddjj.dias_restantes||' día'||CASE WHEN v_proxima_ddjj.dias_restantes=1 THEN '' ELSE 's' END||' para presentar tu Declaración Jurada anual.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal',
      'tone',CASE WHEN v_proxima_ddjj.dias_restantes<=15 THEN 'urgente' WHEN v_proxima_ddjj.dias_restantes<=30 THEN 'alto' ELSE 'medio' END,
      'icono','file-text'));
  END IF;

  IF v_matriculado AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','renovacion_matricula','prioridad',20,'bucket','accion','posponible',false,
      'kicker','OPORTUNIDAD','titulo','Renová tu matrícula RPAC',
      'descripcion','Tu matrícula vence en '||v_dias_a_renovacion||' día'||CASE WHEN v_dias_a_renovacion=1 THEN '' ELSE 's' END||'. Renová ahora y mantené tu habilitación al día.',
      'cta_label','Iniciar renovación','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone',CASE WHEN v_dias_a_renovacion<=15 THEN 'urgente' WHEN v_dias_a_renovacion<=30 THEN 'alto' ELSE 'medio' END,
      'icono','badge-check'));
  END IF;

  IF NOT v_matriculado THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','matricula_inicial','prioridad',30,'bucket','accion','posponible',false,
      'kicker','EMPEZÁ TU CARRERA','titulo','Matriculate como administrador',
      'descripcion','Combinamos curso de formación + trámite de matrícula RPAC. Te acompañamos en todo el proceso.',
      'cta_label','Ver requisitos','cta_path','/formulario/matriculacion-rpac?origen=portal',
      'tone','medio','icono','sparkles'));
  END IF;

  IF v_matriculado AND NOT v_tiene_actualizacion_este_anio THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','curso_actualizacion','prioridad',40,'bucket','accion','posponible',false,
      'kicker','CAPACITACIÓN ANUAL','titulo','Cumplí con tu actualización del año',
      'descripcion','Mantené tu matrícula vigente: el curso de actualización anual es obligatorio (CABA o PBA).',
      'cta_label','Ver cursos','cta_path','/portal/campus','tone','medio','icono','graduation-cap'));
  END IF;

  -- SUAVES · DDJJ diciembre (obligación, NO se suprime por deuda/gracia)
  IF v_matriculado AND NOT v_ddjj_presentada AND EXTRACT(MONTH FROM now())::int = 12
     AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='ddjj_diciembre'
         AND ((e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
           OR (e.last_shown_at IS NOT NULL AND e.last_shown_at>=date_trunc('year',now()) AND e.last_shown_at::date<>CURRENT_DATE))
     ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','ddjj_diciembre','prioridad',55,'bucket','suave','posponible',true,
      'kicker','OBLIGACIÓN ANUAL','titulo','No dejes tu DDJJ para último momento',
      'descripcion','Arrancá cuanto antes tu Declaración Jurada anual y evitá el apuro de fin de período.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal','tone','medio','icono','file-text'));
  END IF;

  -- SUAVES · cross-sell pago: certificado + consultoría (gated por deuda+gracia)
  IF v_matriculado AND v_puede_crosssell AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='certificado_acreditacion'
         AND ((e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
           OR (e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE AND e.last_shown_at::date>CURRENT_DATE-90))
     ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','certificado_acreditacion','prioridad',60,'bucket','suave','posponible',true,
      'kicker','ACREDITACIÓN','titulo','Certificá tu matrícula activa',
      'descripcion','Obtené tu certificado de acreditación RPAC para presentar ante consorcios (asambleas) y las entidades que lo requieran.',
      'cta_label','Solicitar certificado','cta_path','/formulario/certificado-rpac?origen=portal','tone','suave','icono','badge-check'));
  END IF;

  IF v_matriculado AND v_puede_crosssell AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='consultoria_juridica'
         AND ((e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
           OR (e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE AND e.last_shown_at::date>CURRENT_DATE-120))
     ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','consultoria_juridica','prioridad',70,'bucket','suave','posponible',true,
      'kicker','CONSULTORÍA JURÍDICA','titulo','¿Dudas de práctica profesional?',
      'descripcion','Contás con nuestro servicio de consultoría jurídica para las consultas de tu día a día.',
      'cta_label','Consultar','cta_path','/formulario/consultoria-juridica?origen=portal','tone','suave','icono','sparkles'));
  END IF;

  -- SUAVES · webinar gratuito (también gated por gracia; no por deuda — es gratis)
  IF v_webinar_proximo IS NULL AND v_webinar_destacado.id IS NOT NULL
     AND NOT v_recien_llegado
     AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='webinar_destacado'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now()
     ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','webinar_destacado','prioridad',80,'bucket','suave','posponible',true,
      'kicker','WEBINAR GRATUITO','titulo',v_webinar_destacado.titulo,
      'descripcion','Sumate a nuestro próximo webinar formativo sin costo.',
      'cta_label','Inscribirme','cta_path','/portal/webinars','tone','suave','icono','video',
      'webinar_id',v_webinar_destacado.id,'fecha_hora',v_webinar_destacado.fecha_hora));
  END IF;

  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'prioridad')::int), '[]'::jsonb)
  INTO v_oportunidades
  FROM (
    SELECT elem, row_number() OVER (PARTITION BY elem->>'bucket' ORDER BY (elem->>'prioridad')::int) AS rn
    FROM jsonb_array_elements(v_cands) elem
  ) ranked
  WHERE rn = 1;
  -- =========================================================================

  RETURN jsonb_build_object(
    'administracion', jsonb_build_object(
      'id', v_admin.id, 'codigo', v_admin.codigo, 'nombre', v_admin.nombre,
      'responsable_nombre', v_admin.responsable_nombre,
      'responsable_apellido', v_admin.responsable_apellido,
      'foto_url', v_admin.foto_url, 'matricula_rpac', v_admin.matricula_rpac,
      'matricula_rpac_fecha', v_admin.matricula_rpac_fecha,
      'matricula_rpac_vencimiento', v_admin.matricula_rpac_vencimiento,
      'matricula_rpac_dias_a_vencimiento', v_dias_a_renovacion,
      'matricula_rpa', v_admin.matricula_rpa, 'tiene_matricula', v_has_matricula
    ),
    'deuda', jsonb_build_object(
      'total', COALESCE(v_deuda.total, 0), 'tiene_deuda', v_tiene_deuda,
      'pendientes_count', COALESCE(v_deuda.pendientes_count, 0),
      'vencidos_count', COALESCE(v_deuda.vencidos_count, 0),
      'proximo_vencimiento', v_deuda.proximo_vencimiento
    ),
    'clase_hoy', v_clase_hoy, 'webinar_proximo', v_webinar_proximo,
    'cursos_activos', v_cursos_activos, 'tramites_abiertos_count', v_tramites_abiertos,
    'ultimo_tramite', v_ultimo_tramite, 'vencimientos_proximos', v_vencimientos_proximos,
    'oportunidades', v_oportunidades, 'generated_at', now()
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. curso_examen_rendir — gate de contenido accesible (publicación)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_examen_rendir(p_examen_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_examen public.curso_examenes%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = p_examen_id;
  IF v_examen.id IS NULL THEN
    RAISE EXCEPTION 'Examen inexistente' USING ERRCODE = '22023';
  END IF;
  -- DGG-115 (0375): matrícula sola no alcanza — el contenido tiene que estar
  -- publicado (o finalizado, que conserva vigencia). Espeja la RLS de las
  -- tablas hijas: sin esto, un matriculado en pre-venta bajaba el examen por
  -- API aunque la UI no se lo mostrara.
  IF NOT (private.is_staff() OR private.curso_contenido_accesible(v_examen.curso_id)) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'examen', jsonb_build_object(
      'id', v_examen.id, 'curso_id', v_examen.curso_id, 'titulo', v_examen.titulo,
      'descripcion', v_examen.descripcion, 'nota_aprobacion', v_examen.nota_aprobacion,
      'intentos_max', v_examen.intentos_max, 'mostrar_resultados', v_examen.mostrar_resultados,
      'mezclar_preguntas', v_examen.mezclar_preguntas,
      'fecha_habilitacion', v_examen.fecha_habilitacion, 'fecha_cierre', v_examen.fecha_cierre
    ),
    'secciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'titulo', s.titulo,
               'descripcion', s.descripcion, 'orden', s.orden) ORDER BY s.orden)
        FROM public.curso_examen_secciones s WHERE s.examen_id = p_examen_id
    ), '[]'::jsonb),
    'preguntas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id, 'seccion_id', q.seccion_id, 'orden', q.orden,
               'tipo', q.tipo, 'enunciado', q.enunciado, 'puntaje', q.puntaje,
               'opciones', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', o.id, 'orden', o.orden,
                          'texto', o.texto) ORDER BY o.orden)
                   FROM public.curso_opciones o WHERE o.pregunta_id = q.id
               ), '[]'::jsonb)
             ) ORDER BY q.orden)
        FROM public.curso_preguntas q WHERE q.examen_id = p_examen_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. gg_encuentros_recordatorio_diario — acepta 'programado' que se publica
--    antes de la clase (cuerpo = 0374; el ÚNICO cambio es el filtro de estado)
-- ----------------------------------------------------------------------------
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
      -- DGG-115: nunca recordar clases de cursos en borrador. 0375 (C#2): un
      -- curso 'programado' cuya publicación cae ANTES de la clase de hoy SÍ
      -- se recuerda (el cron corre 8AM; sin esto, el mail del primer día de
      -- un curso que se publica ese mediodía jamás salía).
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

-- ----------------------------------------------------------------------------
-- 4. curso_matricular — email de confirmación honesto en pre-venta
--    (cuerpo = 0374; el ÚNICO cambio es la variable fecha_inicio del email)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_matricular(
  p_curso_id uuid, p_profile_id uuid, p_administracion_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso public.cursos%ROWTYPE; v_profile public.profiles%ROWTYPE;
  v_activas integer; v_matricula_id uuid; v_vigencia_hasta date; v_email text; v_nombre text;
  v_fecha_inicio_txt text;
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
  -- DGG-115 (0375, C#14): en pre-venta (curso aún no publicado) sin
  -- fecha_inicio, el mail decía "inicio HOY" (CURRENT_DATE). Ahora: fecha real
  -- si existe; si no, CURRENT_DATE solo cuando el curso YA está publicado; si
  -- no, la fecha de publicación programada (hora AR) o "a confirmar".
  v_fecha_inicio_txt := CASE
    WHEN v_curso.fecha_inicio IS NOT NULL THEN to_char(v_curso.fecha_inicio, 'DD/MM/YYYY')
    WHEN private.curso_estado_publicacion(v_curso.activo, v_curso.publicar_at, v_curso.despublicar_at) = 'publicado'
      THEN to_char(CURRENT_DATE, 'DD/MM/YYYY')
    WHEN v_curso.publicar_at IS NOT NULL
      THEN to_char(v_curso.publicar_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
    ELSE 'a confirmar'
  END;
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email('curso-inscripcion-confirmada', v_email, v_nombre,
      jsonb_build_object('nombre', v_nombre, 'curso_titulo', v_curso.titulo, 'nombre_curso', v_curso.titulo,
        'vigencia_hasta', to_char(v_vigencia_hasta, 'DD/MM/YYYY'),
        'fecha_inicio', v_fecha_inicio_txt),
      p_administracion_id, NULL, 'curso_matriculas', v_matricula_id, 5::smallint);
  END IF;
  RETURN v_matricula_id;
END; $function$;

-- ----------------------------------------------------------------------------
-- 5. [B#3 CRÍTICO] busqueda_global — el bloque de cursos no tenía gate: cualquier
--    authenticated (cliente/partner/alumno) enumeraba id+título+modalidad de
--    TODOS los cursos (ocultos/programados/finalizados). El resultado además
--    linkea a /gerencia/campus — es una búsqueda de gerencia: staff-only.
--    (cuerpo = definición viva; el ÚNICO cambio es el IF v_is_staff del bloque)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.busqueda_global(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id uuid, titulo text, subtitulo text, url_path text, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  q text := lower(trim(coalesce(p_q, '')));
  qlike text;
  v_is_staff boolean := private.is_staff();
  v_adm uuid := private.current_administracion_id();
BEGIN
  IF length(q) < 2 THEN RETURN; END IF;
  qlike := '%' || q || '%';

  RETURN QUERY
  SELECT 'administracion'::text, a.id, a.nombre,
    COALESCE(NULLIF('CUIT ' || a.cuit, 'CUIT '), a.codigo, '—'),
    '/gerencia/clientes/' || a.id::text,
    (similarity(lower(a.nombre), q)
      + CASE WHEN a.cuit IS NOT NULL AND a.cuit LIKE qlike THEN 0.5 ELSE 0 END
      + CASE WHEN a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike THEN 0.3 ELSE 0 END)::real
  FROM administraciones a
  WHERE (lower(a.nombre) LIKE qlike OR (a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike) OR (a.cuit IS NOT NULL AND a.cuit LIKE qlike))
    AND (v_is_staff OR a.id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'comprobante'::text, c.id,
    c.tipo || ' ' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'),
    COALESCE(c.receptor_razon_social, '—') || ' · $' || to_char(coalesce(c.total, 0), 'FM999G999G999D00'),
    '/gerencia/facturacion/' || c.id::text,
    (similarity(lower(coalesce(c.receptor_razon_social, '')), q)
      + CASE WHEN c.numero::text LIKE qlike THEN 0.6 ELSE 0 END
      + CASE WHEN c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM comprobantes c
  WHERE ((c.receptor_razon_social IS NOT NULL AND lower(c.receptor_razon_social) LIKE qlike) OR c.numero::text LIKE qlike OR (c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike))
    AND (v_is_staff OR c.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'tramite'::text, t.id, t.titulo,
    COALESCE(t.categoria, 'trámite') || ' · ' || COALESCE(t.estado, '—'),
    '/gerencia/trackings/' || t.id::text,
    (similarity(lower(t.titulo), q) + CASE WHEN t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike THEN 0.5 ELSE 0 END)::real
  FROM tramites t
  WHERE (lower(t.titulo) LIKE qlike OR (t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike))
    AND (v_is_staff OR t.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'solicitud'::text, s.id,
    COALESCE(s.solicitante_nombre, s.solicitante_email, 'Solicitud sin nombre'),
    COALESCE(NULLIF(s.servicio_slug, ''), 'servicio') || ' · ' || COALESCE(s.estado, 'recibida'),
    '/gerencia/solicitudes/' || s.id::text,
    (similarity(lower(coalesce(s.solicitante_nombre, '')), q)
      + CASE WHEN s.solicitante_email IS NOT NULL AND lower(s.solicitante_email) LIKE qlike THEN 0.5 ELSE 0 END
      + CASE WHEN s.observaciones IS NOT NULL AND lower(s.observaciones) LIKE qlike THEN 0.2 ELSE 0 END
      + CASE WHEN s.solicitante_telefono IS NOT NULL AND s.solicitante_telefono LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM solicitudes s
  WHERE ((s.solicitante_nombre IS NOT NULL AND lower(s.solicitante_nombre) LIKE qlike)
     OR (s.solicitante_email IS NOT NULL AND lower(s.solicitante_email) LIKE qlike)
     OR (s.observaciones IS NOT NULL AND lower(s.observaciones) LIKE qlike)
     OR (s.solicitante_telefono IS NOT NULL AND s.solicitante_telefono LIKE qlike))
    AND (v_is_staff OR s.cliente_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'vencimiento'::text, v.id,
    COALESCE(v.descripcion, v.tipo || ' · ' || v.sujeto),
    'Vence ' || to_char(v.fecha_vencimiento, 'DD/MM/YYYY') || ' · ' || COALESCE(v.estado, '—'),
    '/gerencia/vencimientos?vencimiento=' || v.id::text,
    (similarity(lower(coalesce(v.descripcion, v.tipo || ' ' || v.sujeto)), q))::real
  FROM vencimientos v
  WHERE ((v.descripcion IS NOT NULL AND lower(v.descripcion) LIKE qlike) OR lower(v.tipo) LIKE qlike OR lower(v.sujeto) LIKE qlike)
    AND (v_is_staff OR v.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'servicio'::text, sv.id, sv.nombre,
      COALESCE(sv.descripcion, sv.codigo, '—'),
      '/gerencia/servicios/' || sv.id::text, similarity(lower(sv.nombre), q)::real
    FROM servicios sv
    WHERE lower(sv.nombre) LIKE qlike
       OR (sv.descripcion IS NOT NULL AND lower(sv.descripcion) LIKE qlike)
       OR (sv.codigo IS NOT NULL AND lower(sv.codigo) LIKE qlike)
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

  -- DGG-115 (0375, B#3): cursos era el ÚNICO bloque de entidad interna sin
  -- gate — staff-only, como servicios/partners (el link va a /gerencia).
  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'curso'::text, cu.id, cu.titulo, COALESCE(cu.modalidad, '—'),
      '/gerencia/campus/' || cu.id::text, similarity(lower(cu.titulo), q)::real
    FROM cursos cu
    WHERE lower(cu.titulo) LIKE qlike
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'partner'::text, p.id, p.nombre_legal,
      COALESCE(p.email, p.telefono, p.cuit, '—'),
      '/gerencia/partners/' || p.id::text, similarity(lower(p.nombre_legal), q)::real
    FROM partners p
    WHERE lower(p.nombre_legal) LIKE qlike
       OR (p.email IS NOT NULL AND lower(p.email) LIKE qlike)
       OR (p.cuit IS NOT NULL AND p.cuit LIKE qlike)
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

  RETURN QUERY
  SELECT 'formulario'::text, f.id, f.titulo, COALESCE(f.slug, '—'),
    '/gerencia/formularios/' || f.id::text,
    (similarity(lower(f.titulo), q) + CASE WHEN lower(f.slug) LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM formularios f
  WHERE lower(f.titulo) LIKE qlike OR lower(f.slug) LIKE qlike
  ORDER BY rank DESC LIMIT p_limit;
END;
$function$;

-- [B#23] Versionar el drift repo↔prod: 0065/0066 GRANTeaban a anon pero prod
-- solo tiene authenticated (hubo un REVOKE a mano, R7). Idempotente.
REVOKE EXECUTE ON FUNCTION public.busqueda_global(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.busqueda_global(text, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. [B#4 CRÍTICO] encuentro_sesiones_compartidas — la policy de SELECT usaba
--    curso_matriculado (0236): un matriculado a curso BORRADOR leía por API
--    zoom_join_url/webex_join_url/fecha de la sesión (enumerable con select *).
--    Mismo criterio que las 8 hijas de 0374: contenido accesible.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS sesiones_compartidas_select ON public.encuentro_sesiones_compartidas;
CREATE POLICY sesiones_compartidas_select ON public.encuentro_sesiones_compartidas
  FOR SELECT USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_encuentros e
      WHERE e.sesion_compartida_id = encuentro_sesiones_compartidas.id
        AND private.curso_contenido_accesible(e.curso_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 7. [B#8] curso_encuestas.enc_lectura_matriculados — el EXISTS no filtraba ni
--    estado de matrícula (anulada/vencida leía) ni estado del curso. Mismo
--    criterio central: contenido accesible.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS enc_lectura_matriculados ON public.curso_encuestas;
CREATE POLICY enc_lectura_matriculados ON public.curso_encuestas
  FOR SELECT TO authenticated
  USING (activa AND private.curso_contenido_accesible(curso_id));

-- ----------------------------------------------------------------------------
-- 8. [B#6] curso_iniciar_intento / curso_marcar_clase_completada — validaban
--    dueño+vigencia de la matrícula pero no el estado del curso: con ids
--    cacheados se podía escribir progreso/intentos sobre un curso oculto.
--    Gate central: contenido accesible del curso REAL del examen/clase (de
--    paso cierra el cruce matrícula-de-otro-curso).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_iniciar_intento(p_examen_id uuid, p_matricula_id uuid)
 RETURNS examen_intentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid; v_next smallint; v_row public.examen_intentos; v_curso_id uuid;
BEGIN
  SELECT profile_id INTO v_owner FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023'; END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() AND NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id
      AND (m.estado='activa' OR (m.estado='completada' AND (m.vigencia_hasta IS NULL
            OR m.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))
  ) THEN
    RAISE EXCEPTION 'Tu acceso a este curso no está vigente (matrícula vencida o dada de baja).' USING ERRCODE = '42501';
  END IF;
  -- DGG-115 (0375, B#6): el examen tiene que pertenecer a un curso con
  -- contenido accesible para quien rinde (publicado/finalizado + matriculado).
  SELECT curso_id INTO v_curso_id FROM public.curso_examenes WHERE id = p_examen_id;
  IF v_curso_id IS NULL THEN RAISE EXCEPTION 'Examen inexistente' USING ERRCODE = '22023'; END IF;
  IF NOT private.is_staff() AND NOT private.curso_contenido_accesible(v_curso_id) THEN
    RAISE EXCEPTION 'El contenido de este curso todavía no está disponible.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_matricula_id::text || ':' || p_examen_id::text));
  SELECT COALESCE(max(intento), 0) + 1 INTO v_next
    FROM public.examen_intentos WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id;
  INSERT INTO public.examen_intentos (matricula_id, examen_id, intento)
  VALUES (p_matricula_id, p_examen_id, v_next) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.curso_marcar_clase_completada(p_matricula_id uuid, p_clase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid; v_curso_id uuid;
BEGIN
  SELECT profile_id INTO v_owner FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Matricula inexistente' USING ERRCODE = '22023'; END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() AND NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id
      AND (m.estado='activa' OR (m.estado='completada' AND (m.vigencia_hasta IS NULL
            OR m.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))
  ) THEN
    RAISE EXCEPTION 'Tu acceso a este curso no está vigente (matrícula vencida o dada de baja).' USING ERRCODE = '42501';
  END IF;
  -- DGG-115 (0375, B#6): la clase tiene que pertenecer a un curso con
  -- contenido accesible para quien la marca (publicado/finalizado + matriculado).
  SELECT m.curso_id INTO v_curso_id
  FROM public.curso_clases c JOIN public.curso_modulos m ON m.id = c.modulo_id
  WHERE c.id = p_clase_id;
  IF v_curso_id IS NULL THEN RAISE EXCEPTION 'Clase inexistente' USING ERRCODE = '22023'; END IF;
  IF NOT private.is_staff() AND NOT private.curso_contenido_accesible(v_curso_id) THEN
    RAISE EXCEPTION 'El contenido de este curso todavía no está disponible.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.curso_progreso (matricula_id, clase_id, completada, completada_at)
  VALUES (p_matricula_id, p_clase_id, true, now())
  ON CONFLICT (matricula_id, clase_id)
    DO UPDATE SET completada = true, completada_at = COALESCE(public.curso_progreso.completada_at, now());
END;
$function$;
