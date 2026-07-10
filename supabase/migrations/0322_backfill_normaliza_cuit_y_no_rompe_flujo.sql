-- 0322 · REGRESIÓN (reporte JL). Los triggers de propagación submission→admin
-- (sync 0310 + backfill 0312) tomaban el CUIT de la submission con sólo trim()
-- y hacían `cuit = COALESCE(cuit, v_cuit)`. Cuando el form público trae el CUIT
-- CON GUIONES (ej. "30-64788883-2"), lo escribían tal cual → viola el check
-- administraciones_cuit_check (^\d{11}$). El backfill dispara al crear el trámite
-- DENTRO de solicitud_activar → toda la activación se caía ("Se detuvo el proceso:
-- Alta del cliente"). Antes de 0310/0312 no se backfilleaba el CUIT → no pasaba.
-- Fix en dos capas: (1) normalizar CUIT a 11 dígitos y DNI a 7-8 (basura → NULL);
-- (2) el UPDATE de backfill es BEST-EFFORT: envuelto en EXCEPTION, nunca rompe el
-- flujo padre por un dato del formulario. Misma firma → CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := NULLIF(trim(NEW.datos->>'matricula_rpac'), '');
  v_cuit   := regexp_replace(coalesce(NEW.datos->>'cuit',''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(NEW.datos->>'celular'), ''), NULLIF(trim(NEW.datos->>'telefono'), ''));
  v_nombre   := NULLIF(trim(NEW.datos->>'nombre'), '');
  v_apellido := NULLIF(trim(NEW.datos->>'apellido'), '');
  v_dni      := regexp_replace(coalesce(NEW.datos->>'dni',''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(NEW.datos->>'whatsapp'), ''), NULLIF(trim(NEW.datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(NEW.datos->>'calle'), ''),
    NULLIF(trim(NEW.datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(NEW.datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(NEW.datos->>'piso') END,
    CASE WHEN NULLIF(trim(NEW.datos->>'depto'), '') IS NOT NULL THEN 'Depto ' || trim(NEW.datos->>'depto') END
  )), '');

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL
     AND v_clave IS NULL AND v_matric IS NULL AND v_cuit IS NULL
     AND v_tel IS NULL AND v_nombre IS NULL AND v_apellido IS NULL
     AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL THEN
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
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- backfill best-effort: nunca romper el INSERT de la submission
  END;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
BEGIN
  IF NEW.administracion_id IS NULL OR NEW.formulario_submission_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT datos INTO v_datos FROM public.formulario_submissions WHERE id = NEW.formulario_submission_id;
  IF v_datos IS NULL OR jsonb_typeof(v_datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(v_datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(v_datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(v_datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(v_datos->>'clave_fiscal_arca'), '');
  v_matric := NULLIF(trim(v_datos->>'matricula_rpac'), '');
  v_cuit   := regexp_replace(coalesce(v_datos->>'cuit',''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(v_datos->>'celular'), ''), NULLIF(trim(v_datos->>'telefono'), ''));
  v_nombre   := NULLIF(trim(v_datos->>'nombre'), '');
  v_apellido := NULLIF(trim(v_datos->>'apellido'), '');
  v_dni      := regexp_replace(coalesce(v_datos->>'dni',''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(v_datos->>'whatsapp'), ''), NULLIF(trim(v_datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(v_datos->>'calle'), ''),
    NULLIF(trim(v_datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(v_datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(v_datos->>'piso') END,
    CASE WHEN NULLIF(trim(v_datos->>'depto'), '') IS NOT NULL THEN 'Depto ' || trim(v_datos->>'depto') END
  )), '');

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
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- backfill best-effort: nunca romper el INSERT del trámite / solicitud_activar
  END;
  RETURN NEW;
END $function$;
