-- 0533_dgg218_hardening_agenda_renovacion_en_curso.sql
-- DGG-218 · FASE 1 — §6 HARDENING (hallazgos de la doble auditoría).
--
-- Capitaliza 3 hallazgos del §6 sobre la captura del vencimiento en origen,
-- priorizando la experiencia premium de la agenda de alertas/alarmas (mandato
-- explícito de Pablo):
--
-- (B#9) RANGO DE CORDURA EN EL SYNC DE LANDING. El RPC del portal
--   (cliente_confirmar_vencimiento_matricula) ya clampea 2000-01-01..hoy+10a,
--   pero el sync submission→ficha (fill-only de landing) sólo validaba formato
--   (regex+cast) → una fecha absurda (0202, 9999) podía sembrarse en la ficha de
--   un cliente nuevo. Se agrega el mismo clamp: fuera de rango → NULL (no se
--   escribe). Defensa en profundidad (el runner y el edge ya validan 1900-2100).
--
-- (C#3) BANNER DEL PORTAL "RENOVÁ / VENCIDA" DURANTE UNA RENOVACIÓN EN CURSO.
--   Los candidatos `matricula_vencida` (prio 15) y `renovacion_matricula`
--   (prio 20) de cliente_portal_dashboard leían SOLO la fecha de la ficha, sin
--   mirar si el cliente ya tiene una renovación abierta. Un cliente que acaba de
--   pedir la renovación (y declaró su fecha próxima a vencer, ahora alcanzable
--   por DGG-218) veía de inmediato "Renová tu matrícula". Se suprime cuando hay
--   un trámite categoria='renovacion' abierto — MISMO gate que ya usa
--   `renovacion_postcurso`.
--
-- (C#4) ALARMAS (mail/push) "TU MATRÍCULA VENCE" DURANTE UNA RENOVACIÓN EN
--   CURSO. gg_vencimientos_planificar_alertas emitía las alarmas {45,30,15} de
--   la fila renovacion_rpac aunque hubiera una renovación en curso (hasta que el
--   cierre marcara 'renovado'). Se excluyen las alarmas de tipo renovacion_rpac
--   mientras exista ese trámite abierto.
--
-- Reglas: R16 (firmas idénticas → sin overload), R17 (siguen SECDEF),
-- R18 (smoke e2e en el cierre §6). Todo CREATE OR REPLACE, sin cambios de firma.

-- ───────────────────────────────────────────────────────────────────────────
-- B#9 · SYNC (landing): clamp de cordura del vencimiento (igual al RPC).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_cuit_titular text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
  v_venc_txt text; v_venc date;
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(NEW.datos->>'matricula_rpac'),''), NULLIF(trim(NEW.datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(NEW.datos->>'cuit',''), NEW.datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  IF NEW.datos->>'tipo_persona_solicitante' = 'Persona jurídica' THEN
    v_cuit := NULL;
  END IF;
  v_cuit_titular := regexp_replace(COALESCE(NEW.datos->>'cuit_titular_arca',''), '[^0-9]', '', 'g');
  IF length(v_cuit_titular) <> 11 THEN v_cuit_titular := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(NEW.datos->>'celular'), ''), NULLIF(trim(NEW.datos->>'telefono'), ''));
  v_nombre   := COALESCE(NULLIF(trim(NEW.datos->>'nombre'), ''), NULLIF(trim(NEW.datos->>'representante_legal_nombre'), ''));
  v_apellido := NULLIF(trim(NEW.datos->>'apellido'), '');
  v_dni      := regexp_replace(COALESCE(NULLIF(NEW.datos->>'dni',''), NEW.datos->>'representante_legal_dni', ''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(NEW.datos->>'whatsapp'), ''), NULLIF(trim(NEW.datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(NEW.datos->>'calle'), ''),
    NULLIF(trim(NEW.datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(NEW.datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(NEW.datos->>'piso') END,
    CASE WHEN COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), NULLIF(trim(NEW.datos->>'departamento'),'')) IS NOT NULL
      THEN 'Depto ' || COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), trim(NEW.datos->>'departamento')) END
  )), '');
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'domicilio_empresa'), ''));
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'direccion'), ''));
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');
  -- DGG-218: vencimiento de matrícula. Parseo defensivo + clamp de cordura
  -- (B#9, igual al RPC del portal): fuera de 2000-01-01..hoy+10a → NULL.
  v_venc_txt := NULLIF(trim(NEW.datos->>'matricula_rpac_vencimiento'), '');
  IF v_venc_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN v_venc := v_venc_txt::date; EXCEPTION WHEN OTHERS THEN v_venc := NULL; END;
  END IF;
  IF v_venc IS NOT NULL AND (v_venc < DATE '2000-01-01'
       OR v_venc > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + INTERVAL '10 years') THEN
    v_venc := NULL;
  END IF;

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_cuit_titular IS NULL AND v_tel IS NULL AND v_nombre IS NULL
     AND v_apellido IS NULL AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL
     AND v_localidad IS NULL AND v_provincia IS NULL AND v_cp IS NULL
     AND v_cond_iva IS NULL AND v_dom_fiscal IS NULL AND v_venc IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
      cuit_titular_arca     = COALESCE(cuit_titular_arca,
        CASE WHEN cuit ~ '^(30|33|34)' THEN v_cuit_titular END),
      matricula_rpac        = COALESCE(matricula_rpac, v_matric),
      cuit                  = COALESCE(cuit, v_cuit),
      telefono              = COALESCE(telefono, v_tel),
      responsable_nombre    = COALESCE(responsable_nombre, v_nombre),
      responsable_apellido  = COALESCE(responsable_apellido, v_apellido),
      responsable_dni       = COALESCE(responsable_dni, v_dni),
      whatsapp              = COALESCE(whatsapp, v_whatsapp),
      direccion             = COALESCE(direccion, v_direccion),
      localidad             = COALESCE(localidad, v_localidad),
      provincia             = COALESCE(provincia, v_provincia),
      codigo_postal         = COALESCE(codigo_postal, v_cp),
      condicion_iva         = COALESCE(condicion_iva, v_cond_iva),
      domicilio_fiscal      = COALESCE(domicilio_fiscal, v_dom_fiscal),
      matricula_rpac_vencimiento = COALESCE(matricula_rpac_vencimiento, v_venc),
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C#4 · ALARMAS: no disparar las alarmas de renovacion_rpac si hay una
-- renovación en curso (hasta el cierre, que marca 'renovado' la fila).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gg_vencimientos_planificar_alertas(p_fecha date DEFAULT hoy_ar())
 RETURNS TABLE(vencimiento_id uuid, offset_dias integer, fecha_vencimiento date, administracion_id uuid, consorcio_id uuid, notificar_cliente boolean, tipo text, descripcion text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    o::int AS offset_dias,
    v.fecha_vencimiento,
    v.administracion_id,
    v.consorcio_id,
    v.notificar_cliente,
    v.tipo,
    v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL  -- 0153: excluir pausados
    AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
    -- DGG-218 (C#4): no recordar "tu matrícula vence" si ya hay una renovación
    -- en curso con nosotros (mismo gate que el banner / renovacion_postcurso).
    AND NOT (
      v.tipo = 'renovacion_rpac'
      AND v.administracion_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente')
      )
    );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C#3 · BANNER: suprimir los candidatos matricula_vencida (prio 15) y
-- renovacion_matricula (prio 20) si hay una renovación en curso. Se agrega el
-- booleano v_renovacion_en_curso (mismo gate que renovacion_postcurso).
-- (CREATE OR REPLACE, misma firma sin args → sin overload, R16.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
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
  v_puede_crosssell boolean;
  v_dias_a_renovacion int;
  v_tiene_actualizacion_movil boolean;
  v_proxima_ddjj record;
  v_webinar_destacado record;
  v_hizo_caba boolean;
  v_ofrece boolean;
  v_toques_hoy text[] := '{}';
  v_mes int := EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int;
  v_renovacion_en_curso boolean;  -- DGG-218 C#3
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

  -- DGG-218 (C#3/C#4 gate): ¿tiene una renovación con nosotros en curso?
  SELECT EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = v_admin_id AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ) INTO v_renovacion_en_curso;

  v_dias_a_renovacion := CASE
    WHEN v_admin.matricula_rpac_vencimiento IS NULL THEN NULL
    ELSE (v_admin.matricula_rpac_vencimiento - CURRENT_DATE)::int
  END;

  SELECT * INTO v_deuda FROM public.cliente_deuda_neta(v_admin_id);

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

  IF v_proxima_ddjj.dias_restantes IS NOT NULL AND v_proxima_ddjj.dias_restantes BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','ddjj_proxima','prioridad',10,'bucket','accion','posponible',false,
      'kicker','OBLIGACIÓN ANUAL','titulo','Tu DDJJ vence pronto',
      'descripcion','Tenés '||v_proxima_ddjj.dias_restantes||' día'||CASE WHEN v_proxima_ddjj.dias_restantes=1 THEN '' ELSE 's' END||' para presentar tu Declaración Jurada anual.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal',
      'tone',CASE WHEN v_proxima_ddjj.dias_restantes<=15 THEN 'urgente' WHEN v_proxima_ddjj.dias_restantes<=30 THEN 'alto' ELSE 'medio' END,
      'icono','file-text'));
  END IF;

  IF v_matriculado AND NOT v_renovacion_en_curso AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion < 0 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','matricula_vencida','prioridad',15,'bucket','accion','posponible',false,
      'kicker','MATRÍCULA VENCIDA','titulo','Tu matrícula RPAC está vencida',
      'descripcion','Tu matrícula venció hace '||abs(v_dias_a_renovacion)||' día'||CASE WHEN v_dias_a_renovacion=-1 THEN '' ELSE 's' END||'. Iniciá la renovación para regularizar tu habilitación.',
      'cta_label','Renovar ahora','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone','urgente','icono','badge-check'));
  END IF;

  IF v_matriculado AND NOT v_renovacion_en_curso AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','renovacion_matricula','prioridad',20,'bucket','accion','posponible',false,
      'kicker','OPORTUNIDAD','titulo','Renová tu matrícula RPAC',
      'descripcion','Tu matrícula vence en '||v_dias_a_renovacion||' día'||CASE WHEN v_dias_a_renovacion=1 THEN '' ELSE 's' END||'. Renová ahora y mantené tu habilitación al día.',
      'cta_label','Iniciar renovación','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone',CASE WHEN v_dias_a_renovacion<=15 THEN 'urgente' WHEN v_dias_a_renovacion<=30 THEN 'alto' ELSE 'medio' END,
      'icono','badge-check'));
  END IF;

  IF v_ofrece
     AND NOT EXISTS (
       SELECT 1 FROM public.tramites t
       WHERE t.administracion_id = v_admin_id AND t.categoria = 'renovacion'
         AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
     AND EXISTS (
       SELECT 1 FROM public.ofrecimientos_log ol
       WHERE ol.administracion_id = v_admin_id AND ol.codigo = 'renovacion_postcurso'
         AND ol.canal = 'banner' AND ol.ciclo_ancla > CURRENT_DATE - 30)
  THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','renovacion_postcurso','prioridad',22,'bucket','accion','posponible',false,
      'kicker','RENOVACIÓN DE MATRÍCULA','titulo','Terminaste tu Curso de Actualización',
      'descripcion','Ya tenés el requisito listo para renovar tu matrícula RPAC. Hacemos todo el trámite por vos.',
      'cta_label','Solicitar renovación','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone','medio','icono','badge-check'));
  END IF;

  IF NOT v_matriculado AND NOT v_hizo_caba AND v_ofrece THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','matricula_inicial','prioridad',30,'bucket','accion','posponible',false,
      'kicker','EMPEZÁ TU CARRERA','titulo','Matriculate como administrador',
      'descripcion','Combinamos curso de formación + trámite de matrícula RPAC. Te acompañamos en todo el proceso.',
      'cta_label','Ver requisitos','cta_path','/formulario/matriculacion-rpac?origen=portal',
      'tone','medio','icono','sparkles'));
  END IF;

  IF v_ofrece AND v_matriculado
     AND (NOT v_tiene_actualizacion_movil OR 'curso_actualizacion_60' = ANY(v_toques_hoy)) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'codigo','curso_actualizacion','prioridad',40,'bucket','accion','posponible',false,
      'kicker','CAPACITACIÓN ANUAL','titulo','Cumplí con tu actualización del año',
      'descripcion','Mantené tu matrícula vigente: el curso de actualización anual es obligatorio (CABA o PBA).',
      'cta_label','Ver cursos','cta_path','/portal/campus','tone','medio','icono','graduation-cap'));
  END IF;

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
