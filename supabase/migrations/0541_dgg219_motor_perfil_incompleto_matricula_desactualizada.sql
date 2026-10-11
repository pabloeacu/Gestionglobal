-- 0541_dgg219_motor_perfil_incompleto_matricula_desactualizada.sql
-- =============================================================================
-- DGG-219 · Dos reglas nuevas en el motor de ofrecimientos (DGG-217), cada 120 días:
--   (a) perfil_incompleto       → profesionales con ficha incompleta ("completá tu perfil")
--   (b) matricula_desactualizada → matrícula vencida (dual: actualizá tu fecha / renová con nosotros)
--
-- Decisiones (vía AskUserQuestion con Pablo):
--   · implementar DENTRO del motor (nuevas reglas, cooldown 120d).
--   · "perfil incompleto" = completitud < 100% de TODA la ficha, con opt-outs (no_requiere)
--     contados como resueltos → se alinea EXACTO con contarPendientes() del front (R19).
--   · vencidos → copy DUAL (reemplaza el ofrecimiento de renovación para los ya-vencidos).
--
-- Arquitectura (una sola fuente de verdad, R19 / consistencia):
--   Se extrae el cuerpo de perfil_regulatorio_get() a private.perfil_regulatorio_calc()
--   (sin el guard de tenancy). La RPC pública queda como wrapper (assert + calc) y el
--   motor usa calc() → cero drift entre lo que el cliente ve y lo que dispara el motor.
--
-- Banners de los 2 casos YA existen en el portal (HotCard de ficha + card matricula_vencida
--   del dashboard), por eso el motor sólo agrega email + push. El dashboard NO se toca:
--   su card "matrícula vencida" mantiene CTA a renovación (la ficha no ofrece "renovar con
--   nosotros", así que reencaminarla rompería la promesa dual). El dual vive en el email.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) private.perfil_regulatorio_calc : cuerpo de perfil_regulatorio_get SIN el assert.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.perfil_regulatorio_calc(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  a record; d record;
  v_matriculado_conf boolean; v_matriculado boolean;
  v_mat_fecha date; v_mat_fecha_cert public.certeza_dato;
  v_mat_nro text; v_mat_nro_cert public.certeza_dato;
  v_legajo_nro text; v_legajo_cert public.certeza_dato;
  v_ult_renov date; v_ult_renov_cert public.certeza_dato;
  v_prox_renov date; v_prox_renov_cert public.certeza_dato;
  v_ult_curso date; v_ult_curso_cert public.certeza_dato;
  v_prox_curso date; v_prox_curso_cert public.certeza_dato;
  v_ult_ddjj date; v_ult_ddjj_cert public.certeza_dato;
  v_prox_ddjj date; v_prox_ddjj_cert public.certeza_dato;
  v_ult_cert date; v_ult_cert_cert public.certeza_dato;
  v_prox_cert date; v_prox_cert_cert public.certeza_dato;
  v_ult_cons date; v_ult_cons_cert public.certeza_dato;
  v_matric_cert public.certeza_dato;
  v_jur text;
  v_conf int := 0; v_total int := 9;
  v_venc_renov date; v_venc_ddjj date; v_venc_curso date;
  v_venc_cert public.certeza_dato;
BEGIN
  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac,
         matricula_rpac_vencimiento_certeza
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  v_venc_cert := COALESCE(a.matricula_rpac_vencimiento_certeza, 'confirmado');
  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion','curso_rpa_caba') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa' ELSE d.jurisdiccion END;
  v_matriculado_conf := (a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL) OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion'));
  IF v_matriculado_conf THEN v_matriculado := true; v_matric_cert := 'confirmado';
  ELSIF d.matricula_fecha_declarada IS NOT NULL THEN v_matriculado := true; v_matric_cert := 'declarado';
  ELSE v_matriculado := false; v_matric_cert := 'desconocido'; END IF;
  v_mat_nro := COALESCE(a.matricula_rpac, a.matricula_rpa, d.matricula_nro_declarada);
  v_mat_nro_cert := CASE WHEN a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL THEN 'confirmado'
                         WHEN d.matricula_nro_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_mat_fecha := COALESCE(a.matricula_rpac_fecha, a.matricula_rpa_fecha, d.matricula_fecha_declarada);
  v_mat_fecha_cert := CASE WHEN a.matricula_rpac_fecha IS NOT NULL OR a.matricula_rpa_fecha IS NOT NULL THEN 'confirmado'
                           WHEN d.matricula_fecha_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_legajo_nro := COALESCE(a.legajo_rpac, d.legajo_nro_declarado);
  v_legajo_cert := CASE WHEN a.legajo_rpac IS NOT NULL THEN 'confirmado'
                        WHEN d.legajo_nro_declarado IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_renov
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_renovacion';
  IF v_ult_renov IS NOT NULL THEN v_ult_renov_cert := 'confirmado';
  ELSIF d.ultima_renovacion_declarada IS NOT NULL THEN v_ult_renov := d.ultima_renovacion_declarada; v_ult_renov_cert := 'declarado';
  ELSE v_ult_renov_cert := 'desconocido'; END IF;
  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := v_venc_cert;
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := v_venc_cert;
  ELSIF a.matricula_rpa_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpa_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_curso
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo IN ('curso_actualizacion_rpac','rpa_actualizacion');
  IF v_ult_curso IS NOT NULL THEN v_ult_curso_cert := 'confirmado';
  ELSIF d.ultimo_curso_actualizacion_declarado IS NOT NULL THEN v_ult_curso := d.ultimo_curso_actualizacion_declarado; v_ult_curso_cert := 'declarado';
  ELSE v_ult_curso_cert := 'desconocido'; END IF;
  IF v_venc_curso IS NOT NULL THEN v_prox_curso := v_venc_curso; v_prox_curso_cert := 'confirmado';
  ELSIF v_ult_curso IS NOT NULL THEN v_prox_curso := (v_ult_curso + interval '12 months')::date; v_prox_curso_cert := 'inferido';
  ELSE v_prox_curso_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_ddjj
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_ddjj';
  IF v_ult_ddjj IS NOT NULL THEN v_ult_ddjj_cert := 'confirmado';
  ELSIF d.ultima_ddjj_declarada IS NOT NULL THEN v_ult_ddjj := d.ultima_ddjj_declarada; v_ult_ddjj_cert := 'declarado';
  ELSE v_ult_ddjj_cert := 'desconocido'; END IF;
  IF v_venc_ddjj IS NOT NULL THEN
    v_prox_ddjj := v_venc_ddjj; v_prox_ddjj_cert := 'confirmado';
  ELSIF v_matriculado AND v_jur = 'rpac' THEN
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    IF v_ult_ddjj IS NOT NULL AND v_ult_ddjj >= (v_prox_ddjj - interval '1 year')::date THEN
      v_prox_ddjj := (v_prox_ddjj + interval '1 year')::date;
    END IF;
    v_prox_ddjj_cert := 'inferido';
  ELSE v_prox_ddjj_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cert
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_certificado';
  IF v_ult_cert IS NOT NULL THEN v_ult_cert_cert := 'confirmado';
  ELSIF d.ultimo_certificado_declarado IS NOT NULL THEN v_ult_cert := d.ultimo_certificado_declarado; v_ult_cert_cert := 'declarado';
  ELSE v_ult_cert_cert := 'desconocido'; END IF;
  IF v_ult_cert IS NOT NULL THEN v_prox_cert := (v_ult_cert + interval '3 months')::date; v_prox_cert_cert := 'inferido';
  ELSE v_prox_cert_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cons
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='juridico_consulta';
  IF v_ult_cons IS NOT NULL THEN v_ult_cons_cert := 'confirmado';
  ELSIF d.ultima_consultoria_declarada IS NOT NULL THEN v_ult_cons := d.ultima_consultoria_declarada; v_ult_cons_cert := 'declarado';
  ELSE v_ult_cons_cert := 'desconocido'; END IF;
  v_conf :=
    (v_matric_cert IN ('confirmado','declarado'))::int
    + (v_mat_fecha_cert IN ('confirmado','declarado'))::int
    + (v_legajo_cert IN ('confirmado','declarado'))::int
    + (v_jur IS NOT NULL)::int
    + (v_ult_renov_cert IN ('confirmado','declarado'))::int
    + (v_ult_curso_cert IN ('confirmado','declarado'))::int
    + (v_ult_ddjj_cert IN ('confirmado','declarado'))::int
    + (v_ult_cert_cert IN ('confirmado','declarado'))::int
    + (v_ult_cons_cert IN ('confirmado','declarado'))::int;
  RETURN jsonb_build_object(
    'administracion_id', p_administracion_id, 'jurisdiccion', v_jur,
    'matriculado', jsonb_build_object('valor', v_matriculado, 'certeza', v_matric_cert),
    'matricula', jsonb_build_object('nro', v_mat_nro, 'nro_certeza', v_mat_nro_cert, 'fecha', v_mat_fecha, 'fecha_certeza', v_mat_fecha_cert),
    'legajo', jsonb_build_object('nro', v_legajo_nro, 'nro_certeza', v_legajo_cert),
    'ultima_renovacion', jsonb_build_object('fecha', v_ult_renov, 'certeza', v_ult_renov_cert),
    'proxima_renovacion', jsonb_build_object('fecha', v_prox_renov, 'certeza', v_prox_renov_cert),
    'ultimo_curso_actualizacion', jsonb_build_object('fecha', v_ult_curso, 'certeza', v_ult_curso_cert),
    'proximo_curso_actualizacion', jsonb_build_object('fecha', v_prox_curso, 'certeza', v_prox_curso_cert),
    'ultima_ddjj', jsonb_build_object('fecha', v_ult_ddjj, 'certeza', v_ult_ddjj_cert),
    'proxima_ddjj', jsonb_build_object('fecha', v_prox_ddjj, 'certeza', v_prox_ddjj_cert),
    'ultimo_certificado', jsonb_build_object('fecha', v_ult_cert, 'certeza', v_ult_cert_cert),
    'proximo_certificado', jsonb_build_object('fecha', v_prox_cert, 'certeza', v_prox_cert_cert),
    'ultima_consultoria', jsonb_build_object('fecha', v_ult_cons, 'certeza', v_ult_cons_cert),
    'no_requiere', COALESCE(d.no_requiere, '{}'::jsonb),
    'completitud_pct', round(100.0 * v_conf / v_total)::int, 'generated_at', now());
END $function$;

-- -----------------------------------------------------------------------------
-- 2) perfil_regulatorio_get : wrapper (assert de tenancy + delega en calc). Misma firma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_get(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12
  RETURN private.perfil_regulatorio_calc(p_administracion_id);
END $function$;

-- -----------------------------------------------------------------------------
-- 3) private.gg_admin_ficha_incompleta : espejo EXACTO de contarPendientes() (fichaModel.ts),
--    ignorando el snooze (per-viewer, no es verdad de servidor). opt-outs = resueltos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.gg_admin_ficha_incompleta(p_admin uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH j AS (SELECT private.perfil_regulatorio_calc(p_admin) AS p)
  SELECT
    -- jurisdicción (sin opt-out)
    ((j.p->>'jurisdiccion') IS NULL)
    -- fecha de matrícula (sólo se pide si está matriculado)
    OR ((j.p->'matricula'->>'fecha_certeza')='desconocido' AND COALESCE((j.p->'matriculado'->>'valor')::boolean, false))
    -- 5 obligaciones: última desconocida y sin opt-out en no_requiere
    OR ((j.p->'ultima_renovacion'->>'certeza')='desconocido'           AND NOT (j.p->'no_requiere' ? 'renovacion'))
    OR ((j.p->'ultimo_curso_actualizacion'->>'certeza')='desconocido'  AND NOT (j.p->'no_requiere' ? 'curso_actualizacion'))
    OR ((j.p->'ultima_ddjj'->>'certeza')='desconocido'                 AND NOT (j.p->'no_requiere' ? 'ddjj'))
    OR ((j.p->'ultimo_certificado'->>'certeza')='desconocido'          AND NOT (j.p->'no_requiere' ? 'certificado'))
    OR ((j.p->'ultima_consultoria'->>'certeza')='desconocido'          AND NOT (j.p->'no_requiere' ? 'consultoria'))
  FROM j;
$function$;

-- -----------------------------------------------------------------------------
-- 4) gg_ofrecimiento_elegible : + 'perfil_incompleto' + 'matricula_desactualizada';
--    renovacion_venc gana un guard para NO pisar a los ya-vencidos (autoritativos).
--    Misma firma (R16: CREATE OR REPLACE sin cambiar args).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.gg_ofrecimiento_elegible(p_admin uuid, p_regla text, p_hoy date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_regla

    WHEN 'matriculacion' THEN
      NOT private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_rpac(p_admin)
      AND NOT private.gg_admin_hizo_curso_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NULL
      AND NOT COALESCE((SELECT pr.no_requiere ? 'matriculacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    WHEN 'ddjj_ciclo' THEN
      EXTRACT(MONTH FROM p_hoy)::int IN (11,12,1,2,3)
      AND private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_ddjj' AND t.estado<>'cancelado'
          AND t.created_at >= make_date(EXTRACT(YEAR FROM p_hoy)::int - CASE WHEN EXTRACT(MONTH FROM p_hoy)>=11 THEN 0 ELSE 1 END, 11, 1))
      AND NOT COALESCE((SELECT pr.no_requiere ? 'ddjj' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    WHEN 'curso_venc' THEN
      NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) > (p_hoy + 15)
      AND private.gg_admin_prox_venc_matricula(p_admin) <= (p_hoy + 60)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='curso_actualizacion_rpac' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '12 months')
      AND NOT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id=cm.curso_id LEFT JOIN public.profiles p ON p.id=cm.profile_id
        WHERE COALESCE(cm.administracion_id,p.administracion_id)=p_admin AND cm.estado<>'anulada' AND c.jurisdiccion='pba' AND c.slug ILIKE '%actualizacion%' AND cm.inscripto_at >= now() - interval '12 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'curso_actualizacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    WHEN 'renovacion_venc' THEN
      NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      -- DGG-219 §6 A#2: borde inferior = p_hoy (no hoy-60). Antes, un vencimiento INFERIDO-pasado
      -- con el campo autoritativo NULL caía acá y disparaba "vence en 0 días" (dias_restantes=GREATEST(0,...)).
      AND private.gg_admin_prox_venc_matricula(p_admin) BETWEEN p_hoy AND (p_hoy + 45)
      -- Y si la matrícula ya está vencida según el dato autoritativo → la toma 'matricula_desactualizada'
      -- (copy dual), no renovacion_venc. Doble cobertura: ventana (prox>=hoy) + campo autoritativo.
      AND NOT EXISTS (SELECT 1 FROM public.administraciones a
        WHERE a.id=p_admin AND a.matricula_rpac_vencimiento IS NOT NULL AND a.matricula_rpac_vencimiento < p_hoy)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado<>'cancelado' AND t.created_at >= now() - interval '10 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'renovacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- DGG-219 (b): matrícula VENCIDA/desactualizada (dato autoritativo < hoy). Copy dual.
    WHEN 'matricula_desactualizada' THEN
      NOT private.gg_admin_es_solo_caba(p_admin)
      AND EXISTS (SELECT 1 FROM public.administraciones a
        WHERE a.id=p_admin AND a.matricula_rpac_vencimiento IS NOT NULL AND a.matricula_rpac_vencimiento < p_hoy)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado<>'cancelado' AND t.created_at >= now() - interval '10 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'renovacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    WHEN 'certificado_90' THEN
      private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_certificado' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '90 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'certificado' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    WHEN 'cj_120' THEN
      NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='juridico_consulta' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '120 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'consultoria' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- DGG-219 (a): ficha incompleta (profesionales). Catch-all; va último en la escalera.
    WHEN 'perfil_incompleto' THEN
      (private.gg_admin_es_rpac(p_admin) OR private.gg_admin_hizo_curso_caba(p_admin))
      AND private.gg_admin_ficha_incompleta(p_admin)

    ELSE false
  END;
$function$;

-- -----------------------------------------------------------------------------
-- 5) _gg_ofrecimiento_tocar : + branches de los 2 códigos nuevos. Misma firma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._gg_ofrecimiento_tocar(p_admin uuid, p_contacto text, p_email text, p_user uuid, p_codigo text, p_ancla date, p_titulo text DEFAULT NULL::text, p_form_url text DEFAULT NULL::text, p_fecha_detalle text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tpl text;
  v_asunto text;
  v_vars jsonb;
  v_push_titulo text;
  v_push_cuerpo text;
  v_push_url text;
  v_prox date;
  v_fv date;  -- DGG-219: fecha de vencimiento para matricula_desactualizada
BEGIN
  IF p_codigo = 'matriculacion' THEN
    v_tpl := 'ofrecimiento-matriculacion';
    v_push_titulo := 'Matriculate en el RPAC';
    v_push_cuerpo := 'Te ayudamos a gestionar tu matrícula de administrador.';
    v_push_url := '/formulario/matriculacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'ddjj_ciclo' THEN
    v_tpl := 'ofrecimiento-ddjj';
    v_push_titulo := 'Tu DDJJ anual vence en marzo';
    v_push_cuerpo := 'La preparamos y presentamos por vos. Arrancá hoy.';
    v_push_url := '/formulario/ddjj-anual?origen=ofrecimiento';
  ELSIF p_codigo IN ('curso_venc','curso_actualizacion_60') THEN
    v_tpl := 'ofrecimiento-curso-actualizacion-rpac';
    v_push_titulo := 'Curso de Actualización RPAC';
    v_push_cuerpo := 'Requisito anual para tu matrícula. Reservá tu lugar.';
    v_push_url := '/formulario/curso-actualizacion?origen=ofrecimiento';
  ELSIF p_codigo = 'renovacion_venc' THEN
    v_tpl := 'ofrecimiento-rpac-renovacion';
    v_prox := private.gg_admin_prox_venc_matricula(p_admin);
    v_push_titulo := 'Tu matrícula RPAC vence pronto';
    v_push_cuerpo := 'Renovala a tiempo. Lo gestionamos por vos.';
    v_push_url := '/formulario/renovacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'renovacion_postcurso' THEN
    v_tpl := 'ofrecimiento-rpac-renovacion-postcurso';
    v_push_titulo := 'Curso completado 🎓';
    v_push_cuerpo := 'Ya podés renovar tu matrícula RPAC. Nos encargamos del trámite por vos.';
    v_push_url := '/formulario/renovacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'matricula_desactualizada' THEN
    v_tpl := 'ofrecimiento-matricula-desactualizada';
    SELECT a.matricula_rpac_vencimiento INTO v_fv FROM public.administraciones a WHERE a.id = p_admin;
    v_push_titulo := 'Tu matrícula figura vencida';
    v_push_cuerpo := '¿Ya la renovaste o la gestionamos nosotros? Revisá tu agenda.';
    v_push_url := '/portal/mi-ficha?origen=ofrecimiento';
  ELSIF p_codigo = 'perfil_incompleto' THEN
    v_tpl := 'ofrecimiento-perfil-incompleto';
    v_push_titulo := 'Armá tu agenda de vencimientos';
    v_push_cuerpo := 'Completá tu perfil y dejá que los recordatorios trabajen por vos.';
    v_push_url := '/portal/mi-ficha?origen=ofrecimiento';
  ELSIF p_codigo = 'certificado_90' THEN
    v_tpl := 'ofrecimiento-rpac-certificado';
    v_push_titulo := 'Certificado de acreditación RPAC';
    v_push_cuerpo := 'Tu comprobante oficial de matrícula activa, en un click.';
    v_push_url := '/formulario/certificado-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'cj_120' THEN
    v_tpl := 'ofrecimiento-consultoria-juridica';
    v_push_titulo := 'Consultoría jurídica';
    v_push_cuerpo := '¿Dudas legales en tu administración? Estamos para ayudarte.';
    v_push_url := '/formulario/consultoria-juridica?origen=ofrecimiento';
  ELSE
    v_tpl := 'ofrecimiento-capacitacion-gratuita';
    v_push_titulo := 'Nueva capacitación gratuita';
    v_push_cuerpo := COALESCE(p_titulo, 'Inscribite sin costo — cupos limitados.');
    v_push_url := COALESCE(replace(p_form_url, 'https://gestionglobal.ar', ''), '/portal');
  END IF;

  v_vars := jsonb_build_object('nombre', p_contacto);
  IF p_titulo IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('titulo', p_titulo); END IF;
  IF p_form_url IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('form_url', p_form_url); END IF;
  IF p_fecha_detalle IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('fecha_detalle', p_fecha_detalle); END IF;
  IF p_codigo = 'renovacion_venc' AND v_prox IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object(
      'dias_restantes', GREATEST(0, (v_prox - p_ancla))::text,
      'fecha_vencimiento', to_char(v_prox, 'DD/MM/YYYY'));
  END IF;
  IF p_codigo = 'matricula_desactualizada' AND v_fv IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_fv, 'DD/MM/YYYY'));
  END IF;

  BEGIN
    IF p_email IS NULL OR trim(p_email) = '' THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'skipped', 'sin_email')
      ON CONFLICT DO NOTHING;
    ELSE
      SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_tpl AND activo;
      IF v_asunto IS NULL THEN
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', 'template_inexistente')
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.email_queue
          (kind, template_slug, to_email, to_nombre, variables, prioridad,
           programado_para, scheduled_at, administracion_id,
           related_table, related_id, subject, comprobante_ids, parte, partes_total)
        VALUES
          ('workflow', v_tpl, trim(p_email), p_contacto, v_vars, 7,
           now(), now(), p_admin, 'administraciones', p_admin, v_asunto, '{}', 1, 1);
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'ok')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', SQLERRM)
    ON CONFLICT DO NOTHING;
  END;

  BEGIN
    IF p_user IS NULL THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'skipped', 'sin_usuario_portal')
      ON CONFLICT DO NOTHING;
    ELSE
      PERFORM private.notif_emitir(p_user, 'ofrecimiento', v_push_titulo, v_push_cuerpo, v_push_url, '{}'::jsonb);
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'ok')
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'push', 'error', SQLERRM)
    ON CONFLICT DO NOTHING;
  END;

  INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
  VALUES (p_admin, p_codigo, p_ancla, 'banner', 'ok')
  ON CONFLICT DO NOTHING;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 6) gg_ofrecimientos_diario : + 2 peldaños en la escalera (cooldown 120d).
--    Orden: ... renovacion_venc → matricula_desactualizada → certificado_90 → cj_120 → perfil_incompleto (último).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cap int := 40;
  v_toques int := 0;
  v_cap_cut boolean := false;
  v_admin record;
  v_regla text;
  v_form record;
  v_cnt_cert int := 0; v_cnt_cj int := 0; v_cnt_curso int := 0;
  v_cnt_ddjj int := 0; v_cnt_cap int := 0; v_cnt_caba_venc int := 0;
  v_cnt_matric int := 0; v_cnt_renov int := 0;
  v_cnt_desact int := 0; v_cnt_perfil int := 0;  -- DGG-219
BEGIN
  WITH ult AS (
    SELECT COALESCE(cm.administracion_id, p.administracion_id) AS admin_id,
           max(COALESCE(cm.vigencia_hasta,
               ((cm.inscripto_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                 + interval '12 months')::date)) AS aniversario
    FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id AND c.jurisdiccion = 'caba'
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.estado <> 'anulada'
    GROUP BY 1
  ), objetivo AS (
    SELECT u.admin_id, u.aniversario, a.ofrecimientos_habilitados AS notif
    FROM ult u
    JOIN public.administraciones a ON a.id = u.admin_id
    WHERE u.admin_id IS NOT NULL AND u.aniversario >= v_hoy
      AND a.activo AND a.estado <> 'baja'
      AND a.ofrecimientos_habilitados
  ), superseded AS (
    UPDATE public.vencimientos v SET estado = 'renovado'
    FROM objetivo o
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento <> o.aniversario
    RETURNING v.id
  )
  INSERT INTO public.vencimientos
    (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento,
     fecha_emision, descripcion, estado, alarmas_offsets, notificar_cliente)
  SELECT 'curso_rpa_caba', 'administracion', o.admin_id, o.admin_id,
         o.aniversario, v_hoy, 'Aniversario Curso de Actualización RPA (CABA)',
         'vigente', '{30,15,0}'::int[], o.notif
  FROM objetivo o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento = o.aniversario
  );
  GET DIAGNOSTICS v_cnt_caba_venc = ROW_COUNT;

  FOR v_form IN
    SELECT f.id, f.slug, f.titulo, f.webinar_id, w.fecha_hora
    FROM public.formularios f
    LEFT JOIN public.webinars w ON w.id = f.webinar_id
    WHERE f.categoria = 'evento' AND f.activo = true AND f.publico = true
      AND f.publicado_notificado_at IS NULL
  LOOP
    v_cap_cut := false;
    FOR v_admin IN
      SELECT a.id, a.nombre, a.email, a.user_id,
             COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
      FROM public.administraciones a
      WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
        AND (private.gg_admin_es_rpac(a.id) OR private.gg_admin_hizo_curso_caba(a.id))
        AND (v_form.webinar_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.webinar_inscriptos wi
          WHERE wi.webinar_id = v_form.webinar_id AND wi.administracion_id = a.id))
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id
            AND ol.codigo = 'capacitacion:' || v_form.id::text)
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id AND ol.ciclo_ancla = v_hoy)
    LOOP
      IF v_toques >= v_cap THEN v_cap_cut := true; EXIT; END IF;
      PERFORM public._gg_ofrecimiento_tocar(
        v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id,
        'capacitacion:' || v_form.id::text, v_hoy,
        v_form.titulo,
        'https://gestionglobal.ar/formulario/' || v_form.slug || '?origen=ofrecimiento',
        CASE WHEN v_form.fecha_hora IS NOT NULL
             THEN ' · ' || to_char(v_form.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' hs'
             ELSE '' END);
      v_toques := v_toques + 1;
      v_cnt_cap := v_cnt_cap + 1;
    END LOOP;
    IF NOT v_cap_cut THEN
      UPDATE public.formularios SET publicado_notificado_at = now() WHERE id = v_form.id;
    END IF;
  END LOOP;

  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados
      AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla >= v_hoy - 7);

    v_regla := NULL;

    IF private.gg_ofrecimiento_elegible(v_admin.id, 'matriculacion', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'matriculacion'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'matriculacion';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'ddjj_ciclo', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'ddjj_ciclo'
           AND ol.enviado_at >= (v_hoy - 30)::timestamptz)
    THEN
      v_regla := 'ddjj_ciclo';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'curso_venc', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'curso_venc'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'curso_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'renovacion_venc', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'renovacion_venc'
           AND ol.enviado_at >= (v_hoy - 45)::timestamptz)
    THEN
      v_regla := 'renovacion_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'matricula_desactualizada', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'matricula_desactualizada'
           AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN
      v_regla := 'matricula_desactualizada';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'certificado_90', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'certificado_90'
           AND ol.enviado_at >= (v_hoy - 90)::timestamptz)
    THEN
      v_regla := 'certificado_90';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'cj_120', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'cj_120'
           AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN
      v_regla := 'cj_120';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'perfil_incompleto', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'perfil_incompleto'
           AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN
      v_regla := 'perfil_incompleto';
    END IF;

    CONTINUE WHEN v_regla IS NULL;

    PERFORM public._gg_ofrecimiento_tocar(
      v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id,
      v_regla, v_hoy);
    v_toques := v_toques + 1;
    IF v_regla = 'matriculacion' THEN v_cnt_matric := v_cnt_matric + 1;
    ELSIF v_regla = 'ddjj_ciclo' THEN v_cnt_ddjj := v_cnt_ddjj + 1;
    ELSIF v_regla = 'curso_venc' THEN v_cnt_curso := v_cnt_curso + 1;
    ELSIF v_regla = 'renovacion_venc' THEN v_cnt_renov := v_cnt_renov + 1;
    ELSIF v_regla = 'matricula_desactualizada' THEN v_cnt_desact := v_cnt_desact + 1;
    ELSIF v_regla = 'certificado_90' THEN v_cnt_cert := v_cnt_cert + 1;
    ELSIF v_regla = 'perfil_incompleto' THEN v_cnt_perfil := v_cnt_perfil + 1;
    ELSE v_cnt_cj := v_cnt_cj + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'matriculacion', v_cnt_matric, 'ddjj', v_cnt_ddjj,
    'curso_actualizacion', v_cnt_curso, 'renovacion', v_cnt_renov,
    'matricula_desactualizada', v_cnt_desact, 'perfil_incompleto', v_cnt_perfil,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_vencimientos_generados', v_cnt_caba_venc);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 7) Plantillas de email (manaxer-v1). Banner-imagen hosteado en /email/* (gestionglobal.ar).
--    Banner-led: kicker/titulo_visual vacíos (el banner ES el masthead). ON CONFLICT → idempotente.
-- -----------------------------------------------------------------------------
INSERT INTO public.email_templates
  (slug, nombre, descripcion, asunto, kicker, titulo_visual, color_acento,
   cta_text, cta_url, firma, mostrar_logo, from_casilla, incluir_tabla_envio,
   layout_version, body_html, variables, activo, cuerpo_html_visual)
VALUES (
  'ofrecimiento-perfil-incompleto',
  'Ofrecimiento · Completá tu perfil (agenda de vencimientos)',
  'DGG-219 (a): recordatorio cada 120 días a profesionales con ficha incompleta (contarPendientes>0).',
  'Armá tu agenda de vencimientos profesionales · Gestión Global',
  '', '', '#009ECA',
  'Completar mi perfil', 'https://gestionglobal.ar/portal/mi-ficha?origen=ofrecimiento',
  'Aliados de tu tiempo.', true, 'general', false,
  'manaxer-v1', '<!-- manaxer-v1 -->', '["nombre"]'::jsonb, true,
  $html$<img src="https://www.gestionglobal.ar/email/dgg219-banner.png" alt="Mi agenda de vencimientos profesionales · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 16px;">En medio de tanto, lo importante no puede quedar librado a la memoria: tu <strong>renovación de matrícula</strong>, tu <strong>DDJJ anual</strong>, tu <strong>curso de actualización</strong>. Fechas que, si se pasan, salen caras.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td width="106" valign="middle" style="padding:14px 2px 14px 12px;"><img src="https://www.gestionglobal.ar/email/dgg219-bell.png" width="90" height="90" alt="" style="display:block;width:90px;height:90px;" /></td><td valign="middle" style="padding:16px 18px 16px 6px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Para eso tenés tu plataforma de Gestión Global: te armamos <strong>tu agenda personalizada de vencimientos profesionales</strong> y te avisamos a tiempo —por mail, en tu portal y en tu teléfono— para que nunca llegues tarde.</td></tr></table><p style="margin:0;">Sólo falta un paso: <strong>completá tu perfil</strong> y dejá que los recordatorios trabajen por vos.</p>$html$
)
ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, asunto=EXCLUDED.asunto,
  kicker=EXCLUDED.kicker, titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, firma=EXCLUDED.firma,
  mostrar_logo=EXCLUDED.mostrar_logo, from_casilla=EXCLUDED.from_casilla,
  incluir_tabla_envio=EXCLUDED.incluir_tabla_envio, layout_version=EXCLUDED.layout_version,
  body_html=EXCLUDED.body_html, variables=EXCLUDED.variables, activo=EXCLUDED.activo,
  cuerpo_html_visual=EXCLUDED.cuerpo_html_visual, updated_at=now();

INSERT INTO public.email_templates
  (slug, nombre, descripcion, asunto, kicker, titulo_visual, color_acento,
   cta_text, cta_url, firma, mostrar_logo, from_casilla, incluir_tabla_envio,
   layout_version, body_html, variables, activo, cuerpo_html_visual)
VALUES (
  'ofrecimiento-matricula-desactualizada',
  'Ofrecimiento · Matrícula vencida/desactualizada (dual)',
  'DGG-219 (b): matrícula autoritativa vencida. Dual: actualizá tu fecha / renová con nosotros. Cooldown 120d.',
  'Tu matrícula figura vencida — ¿la actualizamos? · Gestión Global',
  '', '', '#009ECA',
  'Revisar mi matrícula', 'https://gestionglobal.ar/portal/mi-ficha?origen=ofrecimiento',
  'Aliados de tu tiempo.', true, 'general', false,
  'manaxer-v1', '<!-- manaxer-v1 -->', '["nombre","fecha_vencimiento"]'::jsonb, true,
  $html$<img src="https://www.gestionglobal.ar/email/dgg219-banner.png" alt="Mi agenda de vencimientos profesionales · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 16px;">En tu agenda profesional figura que tu <strong>matrícula venció el {{fecha_vencimiento}}</strong>. Puede ser por dos motivos — y los dos los resolvemos en un minuto:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;"><strong>¿Ya la renovaste?</strong> Tal vez la renovaste y todavía no nos lo contaste. <a href="https://gestionglobal.ar/portal/mi-ficha?origen=ofrecimiento" style="color:#0E7490;font-weight:700;">Actualizá tu fecha</a> y tu agenda queda al día.</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#FFF7ED;border-left:4px solid #C46A10;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#7c3a06;"><strong>¿Todavía no?</strong> La hacemos nosotros: nos ocupamos de todo el trámite ante el RPAC. <a href="https://gestionglobal.ar/formulario/renovacion-rpac?origen=ofrecimiento" style="color:#C46A10;font-weight:700;">Renovala con nosotros</a>.</td></tr></table><p style="margin:0;">Tu matrícula al día, sin que tengas que estar encima.</p>$html$
)
ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, asunto=EXCLUDED.asunto,
  kicker=EXCLUDED.kicker, titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, firma=EXCLUDED.firma,
  mostrar_logo=EXCLUDED.mostrar_logo, from_casilla=EXCLUDED.from_casilla,
  incluir_tabla_envio=EXCLUDED.incluir_tabla_envio, layout_version=EXCLUDED.layout_version,
  body_html=EXCLUDED.body_html, variables=EXCLUDED.variables, activo=EXCLUDED.activo,
  cuerpo_html_visual=EXCLUDED.cuerpo_html_visual, updated_at=now();

-- -----------------------------------------------------------------------------
-- 8) Hardening §6 B#4b: las funciones `private` nuevas NO deben ser ejecutables por
--    PUBLIC (authenticated tiene USAGE sobre el schema private). Igualar a la
--    convención de `gg_ofrecimiento_elegible`. perfil_regulatorio_calc es la que NO
--    tiene guard de tenancy → cerrar superficie latente de bypass R12.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.perfil_regulatorio_calc(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.gg_admin_ficha_incompleta(uuid) FROM PUBLIC;

-- =============================================================================
-- SMOKE e2e (R18) — ejecutado por fuera (BEGIN/ROLLBACK vía DO + RAISE EXCEPTION),
-- NO se deja en la migración aplicada porque el rollback abortaría el apply.
-- Resultado (2026-10-11, post-fix §6 A#2): corrida simulada = 34 toques (<cap 40):
--   matriculacion 3 · renovacion 7 · matricula_desactualizada 4 · certificado 14 ·
--   cj 4 · perfil_incompleto 2 · ddjj/curso/capacitacion 0.
-- Los 2 templates se encolan en email_queue con subject+vars correctos
-- (desact con fecha_vencimiento poblada; perfil con nombre). 0 overloads (R16).
-- Para re-ejercitar:
--   DO $smoke$ DECLARE r jsonb; BEGIN
--     r := public.gg_ofrecimientos_diario();
--     RAISE EXCEPTION 'SMOKE %', r::text;   -- aborta → rollback, nada enviado
--   END $smoke$;
-- =============================================================================
