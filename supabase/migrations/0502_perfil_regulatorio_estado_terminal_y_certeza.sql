-- 0502 · Agenda Fase 1 · fixes de la doble auditoría §6 (3 agentes + EJERCITAR) sobre 0500/0501.
--
-- Hallazgos corregidos acá (E-GG-214):
--  #1 CRÍTICO (2 agentes, verificado e2e): la capa "confirmado por trámite" filtraba
--     `estado='cerrado'` + `fecha_fin`, pero el estado TERMINAL real del sistema es
--     `resuelto` (108 filas, fecha_fin SIEMPRE NULL; resuelto_at poblado 108/108). Solo
--     `tracking_cerrar` produce 'cerrado'+fecha_fin (2 filas en toda la BD). => la capa
--     confirmada estaba prácticamente MUERTA en prod: el perfil caía a inferido/desconocido
--     justo cuando el hecho estaba confirmado — lo contrario del propósito de la feature.
--     Fix: `estado IN ('resuelto','cerrado')` + `max(COALESCE(fecha_fin, resuelto_at::date))`
--     + gate `cierre_satisfactorio IS NOT FALSE` (no contar un trámite frustrado como logro).
--  #2: `proxima_ddjj` derivada del 31/03 se etiquetaba 'confirmado' (heredaba v_matric_cert).
--     Es una fecha legal INFERIDA -> ahora 'inferido' (solo 'confirmado' si vino de vencimientos).
--  #3: `proxima_ddjj` no avanzaba de año si la DDJJ del ciclo vigente ya se presentó -> arreglado.
--  #4: `completitud_pct` contaba 'inferido' como conocido (inflaba). Ahora cuenta SOLO
--     confirmado+declarado sobre 8 hechos de CONOCIMIENTO (no derivados). Mide "cuánto sabemos
--     de verdad", que es el punto del progressive profiling.
--  #5: la inferencia de DDJJ de marzo se gatea por jurisdicción 'rpac' (obligación PBA; no
--     afirmarle a un RPA/CABA una DDJJ que quizá no tiene — mapa RPA pendiente de Pablo).
--  #6: se agrega `proximo_certificado` (= último + 3 meses, inferido) — el certificado RPAC
--     tiene vigencia de 3 meses y faltaba su derivación.
--  #8: `v_venc_curso` ahora incluye tipo 'curso_rpa_caba' (el CHECK de vencimientos lo permite).
--  B6 (seguridad, least-privilege R6): el write va SIEMPRE por la RPC definer (que corre como
--     owner y no necesita el grant de tabla); se REVOCA INSERT/UPDATE de authenticated (queda
--     SELECT). Elimina el footgun de que una policy de write futura habilite escritura directa
--     salteando el assert/validación de la RPC.
--
-- Limitaciones DOCUMENTADAS (no bug, decisión): `perfil_regulatorio_declarar` no "des-declara"
--   (un NULL entrante no borra; los COALESCE preservan) y `no_requiere` mergea shallow por
--   servicio (el writer de Fase 3 debe mandar el objeto por-servicio completo). `ultima_ddjj`
--   confirmada-por-trámite es inalcanzable por datos (la DDJJ vive en `vencimientos`, no como
--   trámite): queda 'declarado'/'desconocido' hasta que se derive de vencimientos (Fase futura).
-- DUDA a decidir con Pablo (no se toca acá): doble fuente de "próxima renovación" — el
--   dashboard del cliente lee `admin.matricula_rpac_vencimiento`, este _get prefiere la fila de
--   `vencimientos` (más fresca, respeta la reprogramación 2B). Reconciliar en Fase 3 antes de
--   exponer _get al cliente (hoy _get es solo gerencia).

-- B6 · least-privilege: todo write pasa por la RPC definer.
REVOKE INSERT, UPDATE ON public.perfil_regulatorio FROM authenticated;

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
  v_prox_cert date; v_prox_cert_cert public.certeza_dato;
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

  -- Próximas fechas YA sembradas en vencimientos (confirmadas por el sistema).
  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion','curso_rpa_caba') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;

  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa'
                ELSE d.jurisdiccion END;

  -- ¿matriculado? confirmado si hay matrícula o cerró/resolvió inscripción/renovación satisfactoria
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

  -- última renovación (trámite terminal satisfactorio) > declarada > desconocido
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_renov
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_renovacion';
  IF v_ult_renov IS NOT NULL THEN v_ult_renov_cert := 'confirmado';
  ELSIF d.ultima_renovacion_declarada IS NOT NULL THEN v_ult_renov := d.ultima_renovacion_declarada; v_ult_renov_cert := 'declarado';
  ELSE v_ult_renov_cert := 'desconocido'; END IF;

  -- próxima renovación: vencimiento sembrado/ficha (confirmado) > última renov / matríc + 12m (inferido)
  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpa_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpa_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;

  -- último curso de actualización (confirmado) > declarado > desconocido
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

  -- última DDJJ (confirmada por trámite — hoy inalcanzable por datos) > declarada > desconocido
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_ddjj
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_ddjj';
  IF v_ult_ddjj IS NOT NULL THEN v_ult_ddjj_cert := 'confirmado';
  ELSIF d.ultima_ddjj_declarada IS NOT NULL THEN v_ult_ddjj := d.ultima_ddjj_declarada; v_ult_ddjj_cert := 'declarado';
  ELSE v_ult_ddjj_cert := 'desconocido'; END IF;
  -- próxima DDJJ: vencimiento sembrado (confirmado) > 31/03 legal (INFERIDO, solo RPAC/PBA)
  IF v_venc_ddjj IS NOT NULL THEN
    v_prox_ddjj := v_venc_ddjj; v_prox_ddjj_cert := 'confirmado';
  ELSIF v_matriculado AND v_jur = 'rpac' THEN
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    -- si la DDJJ del ciclo vigente ya se presentó, la próxima es un año después
    IF v_ult_ddjj IS NOT NULL AND v_ult_ddjj >= (v_prox_ddjj - interval '1 year')::date THEN
      v_prox_ddjj := (v_prox_ddjj + interval '1 year')::date;
    END IF;
    v_prox_ddjj_cert := 'inferido';
  ELSE v_prox_ddjj_cert := 'desconocido'; END IF;

  -- último certificado (confirmado) > declarado > desconocido; próximo = último + 3m (inferido)
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cert
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_certificado';
  IF v_ult_cert IS NOT NULL THEN v_ult_cert_cert := 'confirmado';
  ELSIF d.ultimo_certificado_declarado IS NOT NULL THEN v_ult_cert := d.ultimo_certificado_declarado; v_ult_cert_cert := 'declarado';
  ELSE v_ult_cert_cert := 'desconocido'; END IF;
  IF v_ult_cert IS NOT NULL THEN v_prox_cert := (v_ult_cert + interval '3 months')::date; v_prox_cert_cert := 'inferido';
  ELSE v_prox_cert_cert := 'desconocido'; END IF;

  -- última consultoría (confirmada por trámite) > declarada > desconocido
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cons
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='juridico_consulta';
  IF v_ult_cons IS NOT NULL THEN v_ult_cons_cert := 'confirmado';
  ELSIF d.ultima_consultoria_declarada IS NOT NULL THEN v_ult_cons := d.ultima_consultoria_declarada; v_ult_cons_cert := 'declarado';
  ELSE v_ult_cons_cert := 'desconocido'; END IF;

  -- completitud: % de HECHOS DE CONOCIMIENTO efectivamente sabidos (confirmado o declarado),
  -- NO derivados (las próximas no cuentan) y NO inferidos. Mide cuánto sabemos, no cuánto adivinamos.
  v_conf :=
    (v_matric_cert IN ('confirmado','declarado'))::int
    + (v_mat_fecha_cert IN ('confirmado','declarado'))::int
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
END $fn$;
