-- 0534_dgg218_fase2a_trazabilidad_certeza_vencimiento.sql
-- DGG-218 · FASE 2A — Trazabilidad de origen + honestidad de la certeza del
-- vencimiento de matrícula.
--
-- Problema (hallazgo §6 C#9): el vencimiento declarado por el cliente (Fase 1)
-- cae en administraciones.matricula_rpac_vencimiento, la MISMA columna que el
-- backfill oficial TRAMIX (DGG-216). perfil_regulatorio_get lo exponía como
-- certeza='confirmado' hardcodeado → un dato que el cliente "dijo" se mostraba
-- como "Confirmado · Lo sabe Gestión Global", sin distinción de confianza.
--
-- Solución (modelo NULL=confirmado): se agrega la traza de origen/certeza al
-- vencimiento. La columna _certeza es la ÚNICA fuente de verdad de confianza;
-- SÓLO los caminos del CLIENTE la setean a 'declarado'. Todo lo demás (backfill
-- TRAMIX, cierre de trámite, gerencia, legacy) la deja NULL → el get la lee como
-- 'confirmado' (default correcto para esos orígenes confiables). La Fase 2B
-- (re-verificación TRAMIX) luego sube 'declarado' → 'confirmado' si coincide con
-- el expediente oficial, o la deja flaggeada a gerencia.
--
-- Fuente de verdad del vencimiento sigue siendo administraciones.matricula_rpac_
-- vencimiento (consistencia contable, feedback_consistencia_contable). Esto NO
-- la cambia: sólo agrega metadata de confianza al lado.
--
-- Reglas: R16 (firmas idénticas), R17 (SECDEF), R6 (columnas heredan grants de
-- la tabla). Regenerar types tras esta mig (D13).

-- ───────────────────────────────────────────────────────────────────────────
-- A) COLUMNAS DE TRAZA (heredan los GRANT de administraciones)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS matricula_rpac_vencimiento_origen text,
  ADD COLUMN IF NOT EXISTS matricula_rpac_vencimiento_certeza public.certeza_dato,
  ADD COLUMN IF NOT EXISTS matricula_rpac_vencimiento_verificado_at timestamptz;

COMMENT ON COLUMN public.administraciones.matricula_rpac_vencimiento_origen IS
  'DGG-218 F2: origen del vencimiento de matrícula — oficial_tramix | declarado_cliente | gerencia | verificado_tramix. NULL = legacy/confiable.';
COMMENT ON COLUMN public.administraciones.matricula_rpac_vencimiento_certeza IS
  'DGG-218 F2: certeza del vencimiento. NULL se interpreta como confirmado. Sólo los caminos del cliente la ponen en declarado.';
COMMENT ON COLUMN public.administraciones.matricula_rpac_vencimiento_verificado_at IS
  'DGG-218 F2: cuándo se verificó contra TRAMIX/DPPJ (Fase 2B).';

-- Backfill de las existentes: las fichas con vencimiento HOY vienen del backfill
-- oficial TRAMIX (DGG-216) o de carga de gerencia → confiables.
UPDATE public.administraciones
   SET matricula_rpac_vencimiento_origen = 'oficial_tramix',
       matricula_rpac_vencimiento_certeza = 'confirmado'
 WHERE matricula_rpac_vencimiento IS NOT NULL
   AND matricula_rpac_vencimiento_origen IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- B) RPC PORTAL — set origen='declarado_cliente' + certeza='declarado'
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_confirmar_vencimiento_matricula(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_hoy   date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  v_admin := private.current_administracion_id();
  IF v_admin IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No encontramos tu administración activa.';
  END IF;
  PERFORM private.assert_administracion_access(v_admin);

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha de vencimiento es obligatoria.';
  END IF;
  IF p_fecha < DATE '2000-01-01' OR p_fecha > v_hoy + INTERVAL '10 years' THEN
    RAISE EXCEPTION 'La fecha de vencimiento (%) está fuera del rango válido.', p_fecha;
  END IF;

  UPDATE public.administraciones
     SET matricula_rpac_vencimiento = p_fecha,
         -- DGG-218 F2A: el dato lo declara el cliente → certeza 'declarado'
         -- hasta que TRAMIX lo confirme (F2B). Limpia una verificación previa.
         matricula_rpac_vencimiento_origen = 'declarado_cliente',
         matricula_rpac_vencimiento_certeza = 'declarado',
         matricula_rpac_vencimiento_verificado_at = NULL,
         updated_at = now()
   WHERE id = v_admin;

  RETURN jsonb_build_object(
    'ok', true,
    'administracion_id', v_admin,
    'vencimiento', to_char(p_fecha, 'YYYY-MM-DD')
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C) SYNC LANDING — set origen/certeza SÓLO cuando efectivamente rellena
--    (fill-only: la condición mira el valor viejo de la columna).
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
      -- DGG-218 F2A: sólo marca origen/certeza cuando REALMENTE rellena (era NULL).
      matricula_rpac_vencimiento_origen = CASE
        WHEN matricula_rpac_vencimiento IS NULL AND v_venc IS NOT NULL
        THEN 'declarado_cliente' ELSE matricula_rpac_vencimiento_origen END,
      matricula_rpac_vencimiento_certeza = CASE
        WHEN matricula_rpac_vencimiento IS NULL AND v_venc IS NOT NULL
        THEN 'declarado'::public.certeza_dato ELSE matricula_rpac_vencimiento_certeza END,
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- D) perfil_regulatorio_get — la certeza del vencimiento sale de la columna
--    (COALESCE a 'confirmado'), no de un hardcode. Resto IDÉNTICO.
-- ───────────────────────────────────────────────────────────────────────────
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
  v_venc_cert public.certeza_dato;  -- DGG-218 F2A
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac,
         matricula_rpac_vencimiento_certeza
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;

  -- DGG-218 F2A: certeza del vencimiento de matrícula RPAC (NULL = confirmado).
  v_venc_cert := COALESCE(a.matricula_rpac_vencimiento_certeza, 'confirmado');

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

  -- DGG-218 F2A: la certeza de la próxima renovación (cuando sale de la ficha)
  -- refleja el ORIGEN del dato (v_venc_cert), no un hardcode 'confirmado'.
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
