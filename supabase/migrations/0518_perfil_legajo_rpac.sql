-- 0518 · Legajo RPAC en el perfil regulatorio (pedido Pablo 2026-09-28, DGG-206).
--
-- El legajo es la LLAVE para consultar Mesa de Entradas (Tramix/DPPJ). Ya vive CONFIRMADO en
-- administraciones.legajo_rpac (editable en la ficha) y perfil_regulatorio_get ya lo LEÍA pero no lo
-- exponía. Lo integramos al perfil con NIVELES DE CERTEZA, espejando la matrícula:
--   confirmado (ficha) / declarado (perfil) / sin dato.
-- Suma al % de completitud (9 factores en vez de 8; decisión de Pablo). Es dato a recolectar del cliente:
-- cuando el form del portal use la misma RPC, hereda el campo.

ALTER TABLE public.perfil_regulatorio ADD COLUMN IF NOT EXISTS legajo_nro_declarado text;

-- declarar: R16 → DROP la firma vieja (11 params) + CREATE la nueva con p_legajo_nro, para no dejar
-- un overload ambiguo (PostgREST no podría elegir). Re-grant explícito (DROP pierde los grants; R6).
DROP FUNCTION IF EXISTS public.perfil_regulatorio_declarar(uuid, text, date, text, date, date, date, date, date, jsonb, text);

CREATE FUNCTION public.perfil_regulatorio_declarar(
  p_administracion_id uuid,
  p_jurisdiccion text DEFAULT NULL::text,
  p_matricula_fecha date DEFAULT NULL::date,
  p_matricula_nro text DEFAULT NULL::text,
  p_legajo_nro text DEFAULT NULL::text,
  p_ultima_renovacion date DEFAULT NULL::date,
  p_ultimo_curso_actualizacion date DEFAULT NULL::date,
  p_ultima_ddjj date DEFAULT NULL::date,
  p_ultima_consultoria date DEFAULT NULL::date,
  p_ultimo_certificado date DEFAULT NULL::date,
  p_no_requiere jsonb DEFAULT NULL::jsonb,
  p_notas text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12
  IF p_jurisdiccion IS NOT NULL AND p_jurisdiccion NOT IN ('rpac','rpa') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    legajo_nro_declarado, ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado,
    ultima_ddjj_declarada, ultima_consultoria_declarada, ultimo_certificado_declarado,
    no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, p_jurisdiccion, p_matricula_fecha, p_matricula_nro,
    p_legajo_nro, p_ultima_renovacion, p_ultimo_curso_actualizacion,
    p_ultima_ddjj, p_ultima_consultoria, p_ultimo_certificado,
    COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada),
    matricula_nro_declarada = COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada),
    legajo_nro_declarado = COALESCE(EXCLUDED.legajo_nro_declarado, pr.legajo_nro_declarado),
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado),
    ultima_ddjj_declarada = COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada),
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado),
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();
END $function$;

REVOKE ALL ON FUNCTION public.perfil_regulatorio_declarar(uuid, text, date, text, text, date, date, date, date, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_regulatorio_declarar(uuid, text, date, text, text, date, date, date, date, date, jsonb, text) TO authenticated, service_role;

-- get: misma firma (CREATE OR REPLACE conserva grants) → agrega legajo {nro, nro_certeza} espejando la
-- matrícula (confirmado admin / declarado perfil / desconocido) y lo suma al completitud (v_total=9).
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_get(p_administracion_id uuid)
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
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;

  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion','curso_rpa_caba') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;

  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa'
                ELSE d.jurisdiccion END;

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

  -- legajo (RPAC only): confirmado desde la ficha / declarado desde el perfil / sin dato.
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

  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := 'confirmado';
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
    'administracion_id', p_administracion_id,
    'jurisdiccion', v_jur,
    'matriculado', jsonb_build_object('valor', v_matriculado, 'certeza', v_matric_cert),
    'matricula', jsonb_build_object('nro', v_mat_nro, 'nro_certeza', v_mat_nro_cert,
                                    'fecha', v_mat_fecha, 'fecha_certeza', v_mat_fecha_cert),
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
    'completitud_pct', round(100.0 * v_conf / v_total)::int,
    'generated_at', now()
  );
END $function$;
