-- ============================================================================
-- 0399 · DGG-123 (cierre, pedidos Pablo 2026-07-31)
--
-- 1) Columna `administraciones.cuit_titular_arca`: en personas jurídicas, el
--    CUIT personal del titular vinculado en ARCA. Con la clave fiscal es el
--    par con el que la gestoría entra al organismo. Se muestra DENTRO de la
--    ficha (no en la grilla) + editable en el drawer (R14).
-- 2) Backfill automático en los 2 triggers de sincronización (mismo patrón
--    COALESCE-solo-llena-NULL que el resto de los campos ARCA).
-- 3) (Front, mismo chunk) Grilla de clientes: ícono edificio SOLO para
--    personas jurídicas (CUIT 30/33/34), ícono persona para físicas.
--    Máscara de gestoría: MATRÍCULA/LEGAJO RPAC al bloque principal.
--
-- R16: firmas idénticas ⇒ CREATE OR REPLACE seguro.
-- ============================================================================

ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS cuit_titular_arca text;

COMMENT ON COLUMN public.administraciones.cuit_titular_arca IS
  'DGG-123 · PJ: CUIT personal del titular vinculado en ARCA (20/23/24/27). Con clave_fiscal_arca forma el par de acceso al organismo. NULL en personas físicas (su propio cuit ya es el de acceso).';

CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_cuit_titular text; v_tel text; v_nombre text; v_apellido text; v_dni text;
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
  -- DGG-123 (0399): CUIT personal del titular en ARCA (submissions PJ).
  v_cuit_titular := regexp_replace(COALESCE(v_datos->>'cuit_titular_arca',''), '[^0-9]', '', 'g');
  IF length(v_cuit_titular) <> 11 THEN v_cuit_titular := NULL; END IF;
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
  -- DGG-123 (B#3): renovación/certificado PJ traen la sede social en un campo
  -- único `domicilio_empresa` (sin calle/numero) — mismo patrón E-GG-114.
  v_direccion := COALESCE(v_direccion, NULLIF(trim(v_datos->>'domicilio_empresa'), ''));
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
      cuit_titular_arca     = COALESCE(cuit_titular_arca, v_cuit_titular),
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
  -- DGG-123 (B#4): submission declarada jurídica desde el portal → el CUIT
  -- que viaja es el de la EMPRESA; no se backfillea sobre la cuenta logueada.
  IF NEW.datos->>'tipo_persona_solicitante' = 'Persona jurídica' THEN
    v_cuit := NULL;
  END IF;
  -- DGG-123 (0399): CUIT personal del titular en ARCA (submissions PJ).
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
  -- DGG-123 (B#3): sede social en campo único (renovación/certificado PJ).
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'domicilio_empresa'), ''));
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_cuit_titular IS NULL AND v_tel IS NULL AND v_nombre IS NULL
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
      cuit_titular_arca     = COALESCE(cuit_titular_arca, v_cuit_titular),
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
