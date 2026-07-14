-- 0340 · E-GG-114 (doc JL wave 6 · P6-B + barrido mapeo-form): campos del
-- formulario que NO se persisten en la ficha del cliente.
--
-- Causa raíz: mismatch de claves entre el schema del form y los triggers de
-- backfill submission→administración, y campos que la RPC/triggers directamente
-- no mapean:
--   · matrícula: certificado-rpac guarda 'matricula' pero el trigger lee sólo
--     'matricula_rpac' → matrícula NULL (P6-B literal de JL).
--   · CUIT persona jurídica: form 'cuit_persona_juridica' sin fallback → una
--     jurídica queda SIN CUIT.
--   · representante legal: 'representante_legal_nombre/dni' sin mapeo.
--   · localidad/provincia/codigo_postal/condicion_iva/domicilio_fiscal: se pierden.
--     condicion_iva es relevante para la emisión de comprobantes.
--
-- Fix: fallbacks COALESCE (aditivos, idempotentes, nunca pisan valor cargado) en
-- los DOS triggers (path público backfillea sobre tramites; path portal sincroniza
-- sobre la submission) + condicion_iva/domicilio_fiscal en el INSERT de
-- solicitud_activar (del wizard) + backfill de lo ya activado.
-- CREATE OR REPLACE con misma firma → sin overload (R16 ok).

-- ── Trigger 1: backfill_admin_desde_tramite_submission (path público) ──────────
CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
BEGIN
  IF NEW.administracion_id IS NULL OR NEW.formulario_submission_id IS NULL THEN RETURN NEW; END IF;
  SELECT datos INTO v_datos FROM public.formulario_submissions WHERE id = NEW.formulario_submission_id;
  IF v_datos IS NULL OR jsonb_typeof(v_datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(v_datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(v_datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(v_datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(v_datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(v_datos->>'matricula_rpac'),''), NULLIF(trim(v_datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(v_datos->>'cuit',''), v_datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(v_datos->>'celular'), ''), NULLIF(trim(v_datos->>'telefono'), ''));
  v_nombre   := COALESCE(NULLIF(trim(v_datos->>'nombre'), ''), NULLIF(trim(v_datos->>'representante_legal_nombre'), ''));
  v_apellido := NULLIF(trim(v_datos->>'apellido'), '');
  v_dni      := regexp_replace(COALESCE(NULLIF(v_datos->>'dni',''), v_datos->>'representante_legal_dni', ''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(v_datos->>'whatsapp'), ''), NULLIF(trim(v_datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(v_datos->>'calle'), ''),
    NULLIF(trim(v_datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(v_datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(v_datos->>'piso') END,
    CASE WHEN COALESCE(NULLIF(trim(v_datos->>'depto'),''), NULLIF(trim(v_datos->>'departamento'),'')) IS NOT NULL
      THEN 'Depto ' || COALESCE(NULLIF(trim(v_datos->>'depto'),''), trim(v_datos->>'departamento')) END
  )), '');
  v_localidad  := NULLIF(trim(v_datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(v_datos->>'provincia'), '');
  v_cp         := NULLIF(trim(v_datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(v_datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(v_datos->>'domicilio_fiscal'), '');

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
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
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ── Trigger 2: sync_submission_a_administracion (path portal) ──────────────────
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
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
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_tel IS NULL AND v_nombre IS NULL
     AND v_apellido IS NULL AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL
     AND v_localidad IS NULL AND v_provincia IS NULL AND v_cp IS NULL
     AND v_cond_iva IS NULL AND v_dom_fiscal IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
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
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ── solicitud_activar: agregar condicion_iva + domicilio_fiscal al INSERT ──────
-- Patch quirúrgico por string-replace (la función es grande; no cambia firma).
DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.solicitud_activar'::regproc) INTO v_def;
  v_def := replace(v_def,
    'localidad, provincia, codigo_postal, observaciones, estado, activo',
    'localidad, provincia, codigo_postal, condicion_iva, domicilio_fiscal, observaciones, estado, activo');
  v_def := replace(v_def,
    E'NULLIF(p_crear_cliente_input->>''provincia'',''''), NULLIF(p_crear_cliente_input->>''codigo_postal'',''''),\n      NULLIF(p_crear_cliente_input->>''observaciones'','''')',
    E'NULLIF(p_crear_cliente_input->>''provincia'',''''), NULLIF(p_crear_cliente_input->>''codigo_postal'',''''),\n      NULLIF(p_crear_cliente_input->>''condicion_iva'',''''), NULLIF(p_crear_cliente_input->>''domicilio_fiscal'',''''),\n      NULLIF(p_crear_cliente_input->>''observaciones'','''')');
  EXECUTE v_def;
END $mig$;

-- ── Backfill de lo ya activado (scopeado a NULL para no pisar correcciones manuales) ──
UPDATE public.administraciones a SET matricula_rpac = NULLIF(trim(fs.datos->>'matricula'),''), updated_at = now()
  FROM public.tramites t JOIN public.formulario_submissions fs ON fs.id = t.formulario_submission_id
 WHERE t.administracion_id = a.id AND a.matricula_rpac IS NULL
   AND NULLIF(trim(fs.datos->>'matricula'),'') IS NOT NULL;

UPDATE public.administraciones a SET cuit = regexp_replace(fs.datos->>'cuit_persona_juridica','[^0-9]','','g'), updated_at = now()
  FROM public.tramites t JOIN public.formulario_submissions fs ON fs.id = t.formulario_submission_id
 WHERE t.administracion_id = a.id AND a.cuit IS NULL
   AND length(regexp_replace(COALESCE(fs.datos->>'cuit_persona_juridica',''),'[^0-9]','','g')) = 11;
