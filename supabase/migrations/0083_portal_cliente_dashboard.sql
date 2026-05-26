-- 0083 · Portal del cliente · Dashboard inteligente + oportunidades
--
-- RPCs nuevas para alimentar el rediseño premium del portal del
-- administrador. Filosofía: el cliente paga POR ADELANTADO, el portal
-- es sobre SERVICIOS ACTIVOS + OPORTUNIDADES DE RENOVACIÓN, no sobre
-- deuda. Cuenta corriente aparece sólo si hay saldo real pendiente.
--
-- Reglas del nicho codificadas en `cliente_portal_dashboard()`:
--   - DDJJ son anuales (vencimientos.tipo='ddjj_anual')
--   - Curso de formación → única vez (slug contiene 'formacion')
--   - Curso de actualización → anual (slug contiene 'actualizacion')
--   - Matriculación RPAC → única vez (administraciones.matricula_rpac)
--   - Renovación matrícula → anual (administraciones.matricula_rpac_vencimiento)
--
-- Citas: regla 4 (queries en services/), regla 5 (RPC SD+search_path),
-- regla 12 (tenancy: filtramos por current_administracion_id), regla 13
-- (sin window.confirm en frontend).

-- =========================================================================
-- 1) Helper: deuda neta de la administración logueada
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cliente_deuda_neta(p_administracion_id uuid)
RETURNS TABLE (
  total           numeric,
  pendientes_count integer,
  vencidos_count   integer,
  proximo_vencimiento date
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT
    COALESCE(SUM(saldo_pendiente), 0)::numeric AS total,
    COUNT(*)::int AS pendientes_count,
    COUNT(*) FILTER (WHERE vencimiento < CURRENT_DATE)::int AS vencidos_count,
    MIN(vencimiento) FILTER (WHERE vencimiento >= CURRENT_DATE) AS proximo_vencimiento
  FROM public.comprobantes
  WHERE administracion_id = p_administracion_id
    AND saldo_pendiente > 0
    AND estado_cobranza NOT IN ('cancelado','anulado')
    AND estado != 'anulado';
$$;
GRANT EXECUTE ON FUNCTION public.cliente_deuda_neta(uuid) TO authenticated;

-- =========================================================================
-- 2) RPC principal: snapshot completo del dashboard del cliente
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cliente_portal_dashboard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
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
  v_has_matricula boolean;
  v_dias_a_renovacion int;
  v_tiene_actualizacion_este_anio boolean;
  v_proxima_ddjj record;
  v_webinar_destacado record;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  -- Datos básicos del administrador (cliente)
  SELECT id, codigo, nombre, responsable_nombre, responsable_apellido,
         matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_vencimiento, foto_url
    INTO v_admin
  FROM public.administraciones
  WHERE id = v_admin_id;

  v_has_matricula := v_admin.matricula_rpac IS NOT NULL;
  v_dias_a_renovacion := CASE
    WHEN v_admin.matricula_rpac_vencimiento IS NULL THEN NULL
    ELSE (v_admin.matricula_rpac_vencimiento - CURRENT_DATE)::int
  END;

  -- Deuda real (sólo se muestra al cliente si > 0)
  SELECT * INTO v_deuda FROM public.cliente_deuda_neta(v_admin_id);

  -- Clase HOY: encuentro con fecha entre [ahora, ahora+12h] de un curso donde
  -- el cliente tiene matrícula activa
  SELECT jsonb_build_object(
    'encuentro_id', e.id,
    'curso_id', c.id,
    'curso_slug', c.slug,
    'curso_titulo', c.titulo,
    'encuentro_titulo', e.titulo,
    'fecha_hora', e.fecha_hora,
    'minutos_para_inicio', EXTRACT(EPOCH FROM (e.fecha_hora - now()))::int / 60,
    'duracion_min', e.duracion_min,
    'link_zoom', COALESCE(e.zoom_join_url, e.link_zoom),
    'link_webex', e.webex_join_url,
    'plataforma', COALESCE(e.plataforma, 'zoom'),
    'iniciado_at', e.iniciado_at
  ) INTO v_clase_hoy
  FROM public.curso_encuentros e
  JOIN public.cursos c ON c.id = e.curso_id
  WHERE EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.curso_id = c.id
      AND cm.estado = 'activa'
      AND p.administracion_id = v_admin_id
  )
    AND e.fecha_hora BETWEEN (now() - interval '30 minutes') AND (now() + interval '12 hours')
  ORDER BY e.fecha_hora ASC LIMIT 1;

  -- Webinar próximo en el que el cliente está inscripto
  SELECT jsonb_build_object(
    'webinar_id', w.id,
    'titulo', w.titulo,
    'fecha_hora', w.fecha_hora,
    'horas_para_inicio', EXTRACT(EPOCH FROM (w.fecha_hora - now())) / 3600,
    'plataforma', w.plataforma,
    'link', COALESCE(w.zoom_join_url, w.webex_join_url, w.youtube_live_url),
    'status', w.status,
    'inscripto', true
  ) INTO v_webinar_proximo
  FROM public.webinars w
  JOIN public.webinar_inscriptos wi ON wi.webinar_id = w.id
  WHERE wi.administracion_id = v_admin_id
    AND w.fecha_hora >= now() - interval '15 minutes'
    AND w.status IN ('programado','en_curso')
  ORDER BY w.fecha_hora ASC LIMIT 1;

  -- Cursos activos del cliente
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'matricula_id', cm.id,
    'curso_id', c.id,
    'curso_slug', c.slug,
    'curso_titulo', c.titulo,
    'modalidad', c.modalidad,
    'vigencia_hasta', cm.vigencia_hasta,
    'inscripto_at', cm.inscripto_at,
    'banner_url', c.banner_url
  ) ORDER BY cm.inscripto_at DESC), '[]'::jsonb)
  INTO v_cursos_activos
  FROM public.curso_matriculas cm
  JOIN public.cursos c ON c.id = cm.curso_id
  JOIN public.profiles p ON p.id = cm.profile_id
  WHERE p.administracion_id = v_admin_id
    AND cm.estado = 'activa';

  -- Trámites: count abiertos + último con actividad
  SELECT COUNT(*) INTO v_tramites_abiertos
  FROM public.tramites
  WHERE administracion_id = v_admin_id
    AND estado IN ('abierto','en_progreso','esperando_cliente');

  SELECT jsonb_build_object(
    'id', t.id,
    'codigo', t.codigo,
    'titulo', t.titulo,
    'categoria', t.categoria,
    'estado', t.estado,
    'ultima_actividad_at', t.ultima_actividad_at,
    'horas_desde_actividad', EXTRACT(EPOCH FROM (now() - t.ultima_actividad_at)) / 3600
  ) INTO v_ultimo_tramite
  FROM public.tramites t
  WHERE t.administracion_id = v_admin_id
    AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ORDER BY t.ultima_actividad_at DESC LIMIT 1;

  -- Vencimientos próximos (90 días, los 5 más cercanos)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'tipo', v.tipo,
    'descripcion', v.descripcion,
    'fecha_vencimiento', v.fecha_vencimiento,
    'dias_restantes', (v.fecha_vencimiento - CURRENT_DATE)::int,
    'estado', v.estado,
    'consorcio_id', v.consorcio_id,
    'sujeto', v.sujeto
  ) ORDER BY v.fecha_vencimiento ASC), '[]'::jsonb)
  INTO v_vencimientos_proximos
  FROM (
    SELECT * FROM public.vencimientos
    WHERE administracion_id = v_admin_id
      AND estado = 'vigente'
      AND fecha_vencimiento BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '90 days')
    ORDER BY fecha_vencimiento ASC LIMIT 5
  ) v;

  -- ===========================================================
  -- OPORTUNIDADES (cross-sell sutil basado en estado del cliente)
  -- ===========================================================

  -- Detectar si ya hizo curso de actualización este año (mira el slug)
  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE p.administracion_id = v_admin_id
      AND c.slug ILIKE '%actualizacion%'
      AND cm.inscripto_at >= date_trunc('year', now())
  ) INTO v_tiene_actualizacion_este_anio;

  -- Próximo DDJJ del cliente
  SELECT id, fecha_vencimiento, (fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes
    INTO v_proxima_ddjj
  FROM public.vencimientos
  WHERE administracion_id = v_admin_id
    AND tipo = 'ddjj_anual'
    AND estado = 'vigente'
    AND fecha_vencimiento >= CURRENT_DATE
  ORDER BY fecha_vencimiento ASC LIMIT 1;

  -- Próximo webinar en el que NO está inscripto
  SELECT w.id, w.titulo, w.fecha_hora, w.descripcion
    INTO v_webinar_destacado
  FROM public.webinars w
  WHERE w.status = 'programado'
    AND w.fecha_hora >= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.webinar_inscriptos wi
      WHERE wi.webinar_id = w.id AND wi.administracion_id = v_admin_id
    )
  ORDER BY w.fecha_hora ASC LIMIT 1;

  -- Construir array de oportunidades por prioridad
  -- 1. Renovación matrícula próxima (<= 60 días) → MÁXIMA prioridad
  IF v_has_matricula AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion BETWEEN 0 AND 60 THEN
    v_oportunidades := v_oportunidades || jsonb_build_array(jsonb_build_object(
      'codigo', 'renovacion_matricula',
      'kicker', 'OPORTUNIDAD',
      'titulo', 'Renová tu matrícula RPAC',
      'descripcion', 'Tu matrícula vence en ' || v_dias_a_renovacion || ' día' ||
                     CASE WHEN v_dias_a_renovacion = 1 THEN '' ELSE 's' END || '. Renová ahora y mantené tu habilitación al día.',
      'cta_label', 'Iniciar renovación',
      'cta_path', '/portal/nuevo?categoria=renovacion-matricula',
      'tone', CASE WHEN v_dias_a_renovacion <= 15 THEN 'urgente' WHEN v_dias_a_renovacion <= 30 THEN 'alto' ELSE 'medio' END,
      'icono', 'badge-check'
    ));
  END IF;

  -- 2. DDJJ próxima
  IF v_proxima_ddjj.dias_restantes IS NOT NULL AND v_proxima_ddjj.dias_restantes BETWEEN 0 AND 60 THEN
    v_oportunidades := v_oportunidades || jsonb_build_array(jsonb_build_object(
      'codigo', 'ddjj_proxima',
      'kicker', 'OBLIGACIÓN ANUAL',
      'titulo', 'Tu DDJJ vence pronto',
      'descripcion', 'Tenés ' || v_proxima_ddjj.dias_restantes || ' día' ||
                     CASE WHEN v_proxima_ddjj.dias_restantes = 1 THEN '' ELSE 's' END || ' para presentar tu Declaración Jurada anual.',
      'cta_label', 'Iniciar DDJJ',
      'cta_path', '/portal/nuevo?categoria=ddjj',
      'tone', CASE WHEN v_proxima_ddjj.dias_restantes <= 15 THEN 'urgente' WHEN v_proxima_ddjj.dias_restantes <= 30 THEN 'alto' ELSE 'medio' END,
      'icono', 'file-text'
    ));
  END IF;

  -- 3. Curso de actualización anual (si tiene matrícula y NO hizo el de este año)
  IF v_has_matricula AND NOT v_tiene_actualizacion_este_anio THEN
    v_oportunidades := v_oportunidades || jsonb_build_array(jsonb_build_object(
      'codigo', 'curso_actualizacion',
      'kicker', 'CAPACITACIÓN ANUAL',
      'titulo', 'Cumplí con tu actualización del año',
      'descripcion', 'Mantené tu matrícula vigente: el curso de actualización anual es obligatorio (CABA o PBA).',
      'cta_label', 'Ver cursos',
      'cta_path', '/portal/campus',
      'tone', 'medio',
      'icono', 'graduation-cap'
    ));
  END IF;

  -- 4. Sin matrícula → ofrecer comenzar
  IF NOT v_has_matricula THEN
    v_oportunidades := v_oportunidades || jsonb_build_array(jsonb_build_object(
      'codigo', 'matricula_inicial',
      'kicker', 'EMPEZÁ TU CARRERA',
      'titulo', 'Matriculate como administrador',
      'descripcion', 'Combinamos curso de formación + trámite de matrícula RPAC. Te acompañamos en todo el proceso.',
      'cta_label', 'Ver requisitos',
      'cta_path', '/portal/nuevo?categoria=matricula-inicial',
      'tone', 'medio',
      'icono', 'sparkles'
    ));
  END IF;

  -- 5. Webinar próximo destacado (si no está inscripto a nada)
  IF v_webinar_proximo IS NULL AND v_webinar_destacado.id IS NOT NULL THEN
    v_oportunidades := v_oportunidades || jsonb_build_array(jsonb_build_object(
      'codigo', 'webinar_destacado',
      'kicker', 'WEBINAR GRATUITO',
      'titulo', v_webinar_destacado.titulo,
      'descripcion', 'Sumate a nuestro próximo webinar formativo sin costo.',
      'cta_label', 'Inscribirme',
      'cta_path', '/portal/webinars',
      'tone', 'suave',
      'icono', 'video',
      'webinar_id', v_webinar_destacado.id,
      'fecha_hora', v_webinar_destacado.fecha_hora
    ));
  END IF;

  -- Armar respuesta final
  RETURN jsonb_build_object(
    'administracion', jsonb_build_object(
      'id', v_admin.id,
      'codigo', v_admin.codigo,
      'nombre', v_admin.nombre,
      'responsable_nombre', v_admin.responsable_nombre,
      'responsable_apellido', v_admin.responsable_apellido,
      'foto_url', v_admin.foto_url,
      'matricula_rpac', v_admin.matricula_rpac,
      'matricula_rpac_fecha', v_admin.matricula_rpac_fecha,
      'matricula_rpac_vencimiento', v_admin.matricula_rpac_vencimiento,
      'matricula_rpac_dias_a_vencimiento', v_dias_a_renovacion,
      'matricula_rpa', v_admin.matricula_rpa,
      'tiene_matricula', v_has_matricula
    ),
    'deuda', jsonb_build_object(
      'total', COALESCE(v_deuda.total, 0),
      'tiene_deuda', COALESCE(v_deuda.total, 0) > 0,
      'pendientes_count', COALESCE(v_deuda.pendientes_count, 0),
      'vencidos_count', COALESCE(v_deuda.vencidos_count, 0),
      'proximo_vencimiento', v_deuda.proximo_vencimiento
    ),
    'clase_hoy', v_clase_hoy,
    'webinar_proximo', v_webinar_proximo,
    'cursos_activos', v_cursos_activos,
    'tramites_abiertos_count', v_tramites_abiertos,
    'ultimo_tramite', v_ultimo_tramite,
    'vencimientos_proximos', v_vencimientos_proximos,
    'oportunidades', v_oportunidades,
    'generated_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cliente_portal_dashboard() TO authenticated;

COMMENT ON FUNCTION public.cliente_portal_dashboard() IS
  'Snapshot completo del dashboard del cliente: datos admin, deuda real, clase HOY, webinar próximo, cursos activos, trámites abiertos, vencimientos próximos, oportunidades cross-sell.';

-- =========================================================================
-- 3) RPC: catálogo de servicios disponibles para "solicitar nuevo servicio"
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cliente_catalogo_formularios()
RETURNS TABLE (
  formulario_id uuid,
  slug text,
  titulo text,
  descripcion text,
  categoria text
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT id, slug, titulo, descripcion, categoria
  FROM public.formularios
  WHERE activo = true
    AND publico = true
    AND (cierre_at IS NULL OR cierre_at > now())
  ORDER BY
    -- captacion primero (para "empezar"), después tramites/servicios, después el resto
    CASE categoria
      WHEN 'tramite'  THEN 1
      WHEN 'servicio' THEN 2
      WHEN 'consulta' THEN 3
      WHEN 'curso'    THEN 4
      WHEN 'evento'   THEN 5
      ELSE 6
    END,
    titulo;
$$;
GRANT EXECUTE ON FUNCTION public.cliente_catalogo_formularios() TO authenticated;

COMMENT ON FUNCTION public.cliente_catalogo_formularios() IS
  'Lista de formularios públicos activos que el cliente puede iniciar desde su portal.';

-- =========================================================================
-- 4) RPC: trámites del cliente logueado (resumen con conteo de novedades)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cliente_tramites_listar(p_solo_abiertos boolean DEFAULT false)
RETURNS TABLE (
  id uuid,
  codigo text,
  titulo text,
  categoria text,
  prioridad text,
  estado text,
  vence_at timestamptz,
  ultima_actividad_at timestamptz,
  horas_desde_actividad numeric,
  total_comentarios int,
  total_adjuntos int,
  consorcio_id uuid,
  servicio_id uuid,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT
    t.id, t.codigo, t.titulo, t.categoria, t.prioridad, t.estado,
    t.vence_at, t.ultima_actividad_at,
    EXTRACT(EPOCH FROM (now() - t.ultima_actividad_at)) / 3600 AS horas_desde_actividad,
    t.total_comentarios, t.total_adjuntos,
    t.consorcio_id, t.servicio_id, t.created_at
  FROM public.tramites t
  WHERE t.administracion_id = private.current_administracion_id()
    AND (NOT p_solo_abiertos OR t.estado IN ('abierto','en_progreso','esperando_cliente'))
  ORDER BY
    CASE t.estado
      WHEN 'esperando_cliente' THEN 1
      WHEN 'en_progreso'       THEN 2
      WHEN 'abierto'           THEN 3
      ELSE 4
    END,
    t.ultima_actividad_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.cliente_tramites_listar(boolean) TO authenticated;

-- =========================================================================
-- 5) RPC: webinars del cliente (inscriptos + próximos disponibles)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cliente_webinars_listar()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_admin_id uuid;
  v_mis_inscriptos jsonb;
  v_disponibles jsonb;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  -- Mis webinars (inscripto, próximos + pasados últimos 30 días)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'webinar_id', w.id,
    'titulo', w.titulo,
    'descripcion', w.descripcion,
    'fecha_hora', w.fecha_hora,
    'duracion_min', w.duracion_min,
    'status', w.status,
    'plataforma', w.plataforma,
    'link', COALESCE(w.zoom_join_url, w.webex_join_url, w.youtube_live_url),
    'grabacion_url', w.grabacion_url,
    'inscripto_at', wi.inscripto_at,
    'asistio', wi.asistio
  ) ORDER BY w.fecha_hora DESC), '[]'::jsonb)
  INTO v_mis_inscriptos
  FROM public.webinar_inscriptos wi
  JOIN public.webinars w ON w.id = wi.webinar_id
  WHERE wi.administracion_id = v_admin_id
    AND (
      w.fecha_hora >= now() - interval '30 days'
      OR w.status IN ('programado','en_curso')
    );

  -- Disponibles (NO inscripto, programados a futuro)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'webinar_id', w.id,
    'titulo', w.titulo,
    'descripcion', w.descripcion,
    'fecha_hora', w.fecha_hora,
    'duracion_min', w.duracion_min,
    'plataforma', w.plataforma
  ) ORDER BY w.fecha_hora ASC), '[]'::jsonb)
  INTO v_disponibles
  FROM public.webinars w
  WHERE w.status = 'programado'
    AND w.fecha_hora >= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.webinar_inscriptos wi
      WHERE wi.webinar_id = w.id AND wi.administracion_id = v_admin_id
    );

  RETURN jsonb_build_object(
    'mis_webinars', v_mis_inscriptos,
    'disponibles', v_disponibles
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cliente_webinars_listar() TO authenticated;

COMMENT ON FUNCTION public.cliente_webinars_listar() IS
  'Webinars del cliente: los que está inscripto (próximos + pasados 30d) y los disponibles para inscribirse.';
