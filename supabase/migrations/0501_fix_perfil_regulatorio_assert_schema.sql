-- 0501 · HOTFIX de 0500 — el guard de tenencia vive en `private`, no `public`.
-- El 0500 llamó `public.assert_administracion_access(...)`; ese nombre NO existe (el helper
-- canónico es `private.assert_administracion_access`, usado por 20 RPCs). plpgsql compila el
-- cuerpo en runtime, por eso el apply del 0500 pasó pero la PRIMERA llamada real explotaba con
-- 42883. Capitalizado por el EJERCITAR e2e del canon §6 (habría sido un bug de producción en la
-- primera vez que un cliente/gerente abriera su perfil). CREATE OR REPLACE con la MISMA firma
-- (R16: sin overloads nuevos). El 0500 en el repo ya quedó corregido; este archivo repara el DB vivo.

CREATE OR REPLACE FUNCTION public.perfil_regulatorio_declarar(
  p_administracion_id uuid,
  p_jurisdiccion text DEFAULT NULL,
  p_matricula_fecha date DEFAULT NULL,
  p_matricula_nro text DEFAULT NULL,
  p_ultima_renovacion date DEFAULT NULL,
  p_ultimo_curso_actualizacion date DEFAULT NULL,
  p_ultima_ddjj date DEFAULT NULL,
  p_ultima_consultoria date DEFAULT NULL,
  p_ultimo_certificado date DEFAULT NULL,
  p_no_requiere jsonb DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12 (helper vive en private)
  IF p_jurisdiccion IS NOT NULL AND p_jurisdiccion NOT IN ('rpac','rpa') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado, ultima_ddjj_declarada,
    ultima_consultoria_declarada, ultimo_certificado_declarado, no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, p_jurisdiccion, p_matricula_fecha, p_matricula_nro,
    p_ultima_renovacion, p_ultimo_curso_actualizacion, p_ultima_ddjj,
    p_ultima_consultoria, p_ultimo_certificado, COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada),
    matricula_nro_declarada = COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada),
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado),
    ultima_ddjj_declarada = COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada),
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado),
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();
END $fn$;

CREATE OR REPLACE FUNCTION public.perfil_regulatorio_get(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp' SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  a record; d record;
  v_matriculado_conf boolean; v_matriculado boolean;
  v_mat_fecha date; v_mat_fecha_cert public.certeza_dato;
  v_mat_nro text; v_mat_nro_cert public.certeza_dato;
  v_ult_renov date; v_ult_renov_cert public.certeza_dato;
  v_prox_renov date; v_prox_renov_cert public.certeza_dato;
  v_ult_curso date; v_ult_curso_cert public.certeza_dato;
  v_prox_curso date; v_prox_curso_cert public.certeza_dato;
  v_ult_ddjj date; v_ult_ddjj_cert public.certeza_dato;
  v_prox_ddjj date; v_prox_ddjj_cert public.certeza_dato;
  v_ult_cert date; v_ult_cert_cert public.certeza_dato;
  v_ult_cons date; v_ult_cons_cert public.certeza_dato;
  v_matric_cert public.certeza_dato;
  v_jur text;
  v_conf int := 0; v_total int := 8;
  v_venc_renov date; v_venc_ddjj date; v_venc_curso date;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12 (helper vive en private)

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
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;

  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa'
                ELSE d.jurisdiccion END;

  v_matriculado_conf := (a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL) OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado'
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

  SELECT max(t.fecha_fin) INTO v_ult_renov FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_renovacion';
  IF v_ult_renov IS NOT NULL THEN v_ult_renov_cert := 'confirmado';
  ELSIF d.ultima_renovacion_declarada IS NOT NULL THEN v_ult_renov := d.ultima_renovacion_declarada; v_ult_renov_cert := 'declarado';
  ELSE v_ult_renov_cert := 'desconocido'; END IF;

  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpa_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpa_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;

  SELECT max(t.fecha_fin) INTO v_ult_curso FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo IN ('curso_actualizacion_rpac','rpa_actualizacion');
  IF v_ult_curso IS NOT NULL THEN v_ult_curso_cert := 'confirmado';
  ELSIF d.ultimo_curso_actualizacion_declarado IS NOT NULL THEN v_ult_curso := d.ultimo_curso_actualizacion_declarado; v_ult_curso_cert := 'declarado';
  ELSE v_ult_curso_cert := 'desconocido'; END IF;
  IF v_venc_curso IS NOT NULL THEN v_prox_curso := v_venc_curso; v_prox_curso_cert := 'confirmado';
  ELSIF v_ult_curso IS NOT NULL THEN v_prox_curso := (v_ult_curso + interval '12 months')::date; v_prox_curso_cert := 'inferido';
  ELSE v_prox_curso_cert := 'desconocido'; END IF;

  SELECT max(t.fecha_fin) INTO v_ult_ddjj FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_ddjj';
  IF v_ult_ddjj IS NOT NULL THEN v_ult_ddjj_cert := 'confirmado';
  ELSIF d.ultima_ddjj_declarada IS NOT NULL THEN v_ult_ddjj := d.ultima_ddjj_declarada; v_ult_ddjj_cert := 'declarado';
  ELSE v_ult_ddjj_cert := 'desconocido'; END IF;
  IF v_venc_ddjj IS NOT NULL THEN
    v_prox_ddjj := v_venc_ddjj; v_prox_ddjj_cert := 'confirmado';
  ELSIF v_matriculado THEN
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    v_prox_ddjj_cert := v_matric_cert;
  ELSE v_prox_ddjj_cert := 'desconocido'; END IF;

  SELECT max(t.fecha_fin) INTO v_ult_cert FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_certificado';
  IF v_ult_cert IS NOT NULL THEN v_ult_cert_cert := 'confirmado';
  ELSIF d.ultimo_certificado_declarado IS NOT NULL THEN v_ult_cert := d.ultimo_certificado_declarado; v_ult_cert_cert := 'declarado';
  ELSE v_ult_cert_cert := 'desconocido'; END IF;

  SELECT max(t.fecha_fin) INTO v_ult_cons FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='juridico_consulta';
  IF v_ult_cons IS NOT NULL THEN v_ult_cons_cert := 'confirmado';
  ELSIF d.ultima_consultoria_declarada IS NOT NULL THEN v_ult_cons := d.ultima_consultoria_declarada; v_ult_cons_cert := 'declarado';
  ELSE v_ult_cons_cert := 'desconocido'; END IF;

  v_conf :=
    (v_matric_cert <> 'desconocido')::int + (v_mat_fecha_cert <> 'desconocido')::int
    + (v_prox_renov_cert <> 'desconocido')::int + (v_ult_curso_cert <> 'desconocido')::int
    + (v_prox_ddjj_cert <> 'desconocido')::int + (v_ult_ddjj_cert <> 'desconocido')::int
    + (v_ult_cert_cert <> 'desconocido')::int + (v_ult_cons_cert <> 'desconocido')::int;

  RETURN jsonb_build_object(
    'administracion_id', p_administracion_id,
    'jurisdiccion', v_jur,
    'matriculado', jsonb_build_object('valor', v_matriculado, 'certeza', v_matric_cert),
    'matricula', jsonb_build_object('nro', v_mat_nro, 'nro_certeza', v_mat_nro_cert,
                                    'fecha', v_mat_fecha, 'fecha_certeza', v_mat_fecha_cert),
    'ultima_renovacion', jsonb_build_object('fecha', v_ult_renov, 'certeza', v_ult_renov_cert),
    'proxima_renovacion', jsonb_build_object('fecha', v_prox_renov, 'certeza', v_prox_renov_cert),
    'ultimo_curso_actualizacion', jsonb_build_object('fecha', v_ult_curso, 'certeza', v_ult_curso_cert),
    'proximo_curso_actualizacion', jsonb_build_object('fecha', v_prox_curso, 'certeza', v_prox_curso_cert),
    'ultima_ddjj', jsonb_build_object('fecha', v_ult_ddjj, 'certeza', v_ult_ddjj_cert),
    'proxima_ddjj', jsonb_build_object('fecha', v_prox_ddjj, 'certeza', v_prox_ddjj_cert),
    'ultimo_certificado', jsonb_build_object('fecha', v_ult_cert, 'certeza', v_ult_cert_cert),
    'ultima_consultoria', jsonb_build_object('fecha', v_ult_cons, 'certeza', v_ult_cons_cert),
    'no_requiere', COALESCE(d.no_requiere, '{}'::jsonb),
    'completitud_pct', round(100.0 * v_conf / v_total)::int,
    'generated_at', now()
  );
END $fn$;
