-- 0451_dgg145_banner_sin_filtro_morosos_y_cron_en_linaje.sql
-- DGG-145 (parte 2/2) + hallazgos §6 de la mig 0450.
--
-- (1) `cliente_portal_dashboard` v4: la decisión de Pablo (2026-08-22,
--     opción b — "el ofrecimiento no discrimina estado de cuenta, lo mismo
--     para todos") aplica a los TRES canales del circuito. La mig 0450
--     liberó email/push/banner-forzado del motor, pero la RECURRENCIA
--     propia del banner del portal seguía gateada por deuda
--     (`v_puede_crosssell := NOT v_tiene_deuda AND NOT v_recien_llegado`,
--     mig 0446): un cliente con deuda no veía las cards
--     certificado_acreditacion / consultoria_juridica salvo el día exacto
--     del toque — y con el cron desagendado, NUNCA (hallazgo §6-B/§6-C).
--     Cambio quirúrgico: `v_puede_crosssell := NOT v_recien_llegado`.
--     Se CONSERVA la gracia de 15 días del recién llegado (onboarding,
--     no es estado de cuenta) y el bloque 'deuda' del payload (la card
--     informativa "SALDO PENDIENTE" de DGG-45r no cambia).
--     Base: definición viva verificada por md5 contra prod (drift vs
--     archivo 0446 = sólo comentarios). Firma intacta (0 args → jsonb)
--     ⇒ CREATE OR REPLACE conserva GRANTs (R16 no aplica).
--
-- (2) Cron `gg-ofrecimientos-diario` DESAGENDADO EN EL LINAJE (hallazgo
--     §6-A #10): la mig 0445 lo agenda y ninguna migración lo desagendaba —
--     el estado "apagado hasta que Pablo revise las plantillas" vivía sólo
--     en runtime. En un entorno reconstruido desde cero, el motor arrancaba
--     solo (ahora con audiencia ampliada por 0450). Guard idempotente al
--     final. La reactivación será una mig explícita cuando Pablo dé el OK.

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
  v_puede_crosssell boolean;            -- DGG-145: sólo gracia 15d (sin deuda)
  v_dias_a_renovacion int;
  v_tiene_actualizacion_movil boolean;  -- E4-F5: 12 meses móviles, sólo PBA
  v_proxima_ddjj record;
  v_webinar_destacado record;
  v_hizo_caba boolean;                  -- E4-F5: elegibilidad SOLO-CABA p/ CJ
  v_ofrece boolean;                     -- E4-F5: opt-out de ofrecimientos
  v_toques_hoy text[] := '{}';          -- E4-F5: toques del motor de HOY
  v_mes int := EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  SELECT id, codigo, nombre, responsable_nombre, responsable_apellido,
         matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_vencimiento, foto_url, created_at,
         ofrecimientos_habilitados
    INTO v_admin
  FROM public.administraciones
  WHERE id = v_admin_id;

  v_has_matricula := v_admin.matricula_rpac IS NOT NULL;
  v_ofrece := COALESCE(v_admin.ofrecimientos_habilitados, true);
  v_hizo_caba := private.gg_admin_hizo_curso_caba(v_admin_id);

  SELECT COALESCE(array_agg(DISTINCT ol.codigo), '{}') INTO v_toques_hoy
  FROM public.ofrecimientos_log ol
  WHERE ol.administracion_id = v_admin_id
    AND ol.canal = 'banner'
    AND ol.ciclo_ancla = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

  v_matriculado := v_has_matricula OR EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id
      AND t.estado = 'cerrado'
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
  );

  v_dias_a_renovacion := CASE
    WHEN v_admin.matricula_rpac_vencimiento IS NULL THEN NULL
    ELSE (v_admin.matricula_rpac_vencimiento - CURRENT_DATE)::int
  END;

  SELECT * INTO v_deuda FROM public.cliente_deuda_neta(v_admin_id);

  -- DGG-145 (2026-08-22, pisa el gate DGG-45r): el estado de cuenta NO
  -- filtra ofrecimientos en NINGÚN canal. v_tiene_deuda queda sólo para el
  -- payload informativo de la card "SALDO PENDIENTE". Se conserva la gracia
  -- de 15 días del recién llegado (onboarding, no estado de cuenta).
  v_tiene_deuda    := COALESCE(v_deuda.total, 0) > 0;
  v_recien_llegado := (now() - v_admin.created_at) < interval '15 days';
  v_puede_crosssell := NOT v_recien_llegado;

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

  -- E4-F5 (2) · señal real: curso PBA de actualización en 12 meses móviles
  -- (matcheo por jurisdicción + admin directa o vía profile, como el motor).
  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE COALESCE(cm.administracion_id, p.administracion_id) = v_admin_id
      AND cm.estado <> 'anulada'
      AND c.jurisdiccion = 'pba'
      AND c.slug ILIKE '%actualizacion%'
      AND cm.inscripto_at >= now() - interval '12 months'
  ) INTO v_tiene_actualizacion_movil;

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
  IF v_proxima_ddjj.dias_restantes IS NOT NULL AND v_proxima_ddjj.dias_restantes BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','ddjj_proxima','prioridad',10,'bucket','accion','posponible',false,
      'kicker','OBLIGACIÓN ANUAL','titulo','Tu DDJJ vence pronto',
      'descripcion','Tenés '||v_proxima_ddjj.dias_restantes||' día'||CASE WHEN v_proxima_ddjj.dias_restantes=1 THEN '' ELSE 's' END||' para presentar tu Declaración Jurada anual.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal',
      'tone',CASE WHEN v_proxima_ddjj.dias_restantes<=15 THEN 'urgente' WHEN v_proxima_ddjj.dias_restantes<=30 THEN 'alto' ELSE 'medio' END,
      'icono','file-text'));
  END IF;

  IF v_matriculado AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion < 0 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','matricula_vencida','prioridad',15,'bucket','accion','posponible',false,
      'kicker','MATRÍCULA VENCIDA','titulo','Tu matrícula RPAC está vencida',
      'descripcion','Tu matrícula venció hace '||abs(v_dias_a_renovacion)||' día'||CASE WHEN v_dias_a_renovacion=-1 THEN '' ELSE 's' END||'. Iniciá la renovación para regularizar tu habilitación.',
      'cta_label','Renovar ahora','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone','urgente','icono','badge-check'));
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

  IF NOT v_matriculado AND NOT v_hizo_caba AND v_ofrece THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','matricula_inicial','prioridad',30,'bucket','accion','posponible',false,
      'kicker','EMPEZÁ TU CARRERA','titulo','Matriculate como administrador',
      'descripcion','Combinamos curso de formación + trámite de matrícula RPAC. Te acompañamos en todo el proceso.',
      'cta_label','Ver requisitos','cta_path','/formulario/matriculacion-rpac?origen=portal',
      'tone','medio','icono','sparkles'));
  END IF;

  -- E4-F5 (2)+(4) · actualización PBA: señal 12 meses móviles + forzada el
  -- día del toque del motor. Sólo clientes RPAC (no SOLO-CABA) con opt-in.
  IF v_ofrece AND v_matriculado
     AND (NOT v_tiene_actualizacion_movil OR 'curso_actualizacion_60' = ANY(v_toques_hoy)) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','curso_actualizacion','prioridad',40,'bucket','accion','posponible',false,
      'kicker','CAPACITACIÓN ANUAL','titulo','Cumplí con tu actualización del año',
      'descripcion','Mantené tu matrícula vigente: el curso de actualización anual es obligatorio (CABA o PBA).',
      'cta_label','Ver cursos','cta_path','/portal/campus','tone','medio','icono','graduation-cap'));
  END IF;

  -- E4-F5 (1) · empujón DDJJ nov→mar (antes sólo diciembre).
  IF v_ofrece AND v_matriculado AND NOT v_ddjj_presentada AND v_mes IN (11,12,1,2,3)
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

  -- E4-F5 (4) · certificado: recurrencia propia O toque del motor hoy; el
  -- "posponer" del cliente SIEMPRE gana.
  IF v_ofrece AND v_matriculado
     AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='certificado_acreditacion'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
     AND ( 'certificado_90' = ANY(v_toques_hoy)
        OR (v_puede_crosssell AND NOT EXISTS (
             SELECT 1 FROM public.cliente_oportunidad_eventos e
             WHERE e.administracion_id=v_admin_id AND e.codigo='certificado_acreditacion'
               AND e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE
               AND e.last_shown_at::date>CURRENT_DATE-90)) )
  THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','certificado_acreditacion','prioridad',60,'bucket','suave','posponible',true,
      'kicker','ACREDITACIÓN','titulo','Certificá tu matrícula activa',
      'descripcion','Obtené tu certificado de acreditación RPAC para presentar ante consorcios (asambleas) y las entidades que lo requieran.',
      'cta_label','Solicitar certificado','cta_path','/formulario/certificado-rpac?origen=portal','tone','suave','icono','badge-check'));
  END IF;

  -- E4-F5 (3)+(4) · CJ: también para SOLO-CABA + forzada el día del toque.
  IF v_ofrece AND (v_matriculado OR v_hizo_caba)
     AND NOT EXISTS (
       SELECT 1 FROM public.cliente_oportunidad_eventos e
       WHERE e.administracion_id=v_admin_id AND e.codigo='consultoria_juridica'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
     AND ( 'cj_120' = ANY(v_toques_hoy)
        OR (v_puede_crosssell AND NOT EXISTS (
             SELECT 1 FROM public.cliente_oportunidad_eventos e
             WHERE e.administracion_id=v_admin_id AND e.codigo='consultoria_juridica'
               AND e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE
               AND e.last_shown_at::date>CURRENT_DATE-120)) )
  THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','consultoria_juridica','prioridad',70,'bucket','suave','posponible',true,
      'kicker','CONSULTORÍA JURÍDICA','titulo','¿Dudas de práctica profesional?',
      'descripcion','Contás con nuestro servicio de consultoría jurídica para las consultas de tu día a día.',
      'cta_label','Consultar','cta_path','/formulario/consultoria-juridica?origen=portal','tone','suave','icono','sparkles'));
  END IF;

  IF v_ofrece AND v_webinar_proximo IS NULL AND v_webinar_destacado.id IS NOT NULL
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

-- (2) ─ Cron del motor: desagendado también en el linaje de migraciones.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-ofrecimientos-diario') THEN
    PERFORM cron.unschedule('gg-ofrecimientos-diario');
  END IF;
END $$;
