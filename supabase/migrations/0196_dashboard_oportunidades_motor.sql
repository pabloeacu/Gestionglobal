-- ============================================================================
-- 0196 · DGG-45 · Rewrite del bloque de oportunidades de cliente_portal_dashboard
--
-- - "matriculado" = matricula_rpac IS NOT NULL **O** trámite de matrícula
--   ("Inscripción al RPAC%") cerrado.  ← arregla el bug de Estudio Save.
-- - Banner "Matriculate" sólo si NO matriculado.
-- - NUEVOS: certificado de acreditación (cada 90d), consultoría jurídica
--   (cada 120d), DDJJ "arrancá temprano" (diciembre, 1×/año).
-- - Prioridad + máx 2 (top-1 acción + top-1 suave).
-- - Recurrencia "desde la última vez mostrado" (last_shown_at) + posponer
--   30d (snoozed_until) leídos de cliente_oportunidad_eventos (mig 0195).
-- - CTAs directos a /formulario/:slug?origen=portal.
--
-- Verificado e2e bajo JWT real de cliente: matricula_inicial ausente para
-- matriculado; posponer oculta el suave y entra el siguiente por prioridad.
-- ============================================================================

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
  v_cands jsonb := '[]'::jsonb;          -- DGG-45 candidatos pre-selección
  v_has_matricula boolean;               -- número RPAC cargado (para badge Hero)
  v_matriculado boolean;                 -- DGG-45 robusto (número O trámite cerrado)
  v_ddjj_presentada boolean;             -- DGG-45 nudge diciembre
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
         matricula_rpa, matricula_rpa_vencimiento, foto_url
    INTO v_admin
  FROM public.administraciones
  WHERE id = v_admin_id;

  v_has_matricula := v_admin.matricula_rpac IS NOT NULL;

  -- DGG-45 · "matriculado" robusto: número cargado O trámite de matrícula
  -- ("Inscripción al RPAC%") cerrado. Arregla el bug de Estudio Save.
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

  -- ¿DDJJ ya iniciada este año? (nudge de diciembre)
  v_ddjj_presentada := EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id
      AND s.nombre ILIKE 'Declaraciones juradas%'
      AND t.created_at >= date_trunc('year', now())
  );

  -- ============================ DGG-45 · MOTOR DE BANNERS ===================
  -- ACCIÓN / OBLIGACIÓN (no posponibles)
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

  -- SUAVES (posponibles + recurrencia "desde la última vez mostrado")
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

  IF v_matriculado AND NOT EXISTS (
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

  IF v_matriculado AND NOT EXISTS (
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

  IF v_webinar_proximo IS NULL AND v_webinar_destacado.id IS NOT NULL
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

  -- Selección: top-1 por bucket (máx 2 = 1 acción + 1 suave), orden por prioridad
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
      'total', COALESCE(v_deuda.total, 0), 'tiene_deuda', COALESCE(v_deuda.total, 0) > 0,
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
