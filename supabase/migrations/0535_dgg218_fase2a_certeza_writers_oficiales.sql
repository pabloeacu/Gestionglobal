-- 0535_dgg218_fase2a_certeza_writers_oficiales.sql
-- DGG-218 · FASE 2A — HARDENING §6 (hallazgo #2 de la doble auditoría).
--
-- Problema: los writers OFICIALES/SISTEMA de administraciones.matricula_rpac_
-- vencimiento (cierre de trámite trg_tramite_cierre_setea_vencimiento_fn, y los
-- RPC de tracking tracking_cerrar_ciclo / tracking_programar_vencimientos_rpac /
-- tracking_cargar_otorgamiento / tracking_moderar_gestor_avance, más el alta/
-- edición de gerencia por PostgREST) PISAN la fecha pero NO tocan _certeza /
-- _origen. Si una ficha quedó en certeza='declarado' (declaración del cliente,
-- Fase 1) y luego un camino oficial pisa la fecha, la certeza quedaba STALE en
-- 'declarado' → un vencimiento recién confirmado por gestoría se mostraba como
-- "Declarado por el cliente · a verificar". (Latente hoy: 0 fichas 'declarado'.)
--
-- Fix DRY (un solo lugar, cubre los 5 writers + futuros): un trigger BEFORE
-- UPDATE que, cuando CAMBIA la fecha y el statement NO viene de un camino de
-- cliente (flag de sesión app.venc_declarado), asume origen oficial/sistema →
-- certeza=NULL (=confirmado), origen='gerencia', verificado_at=NULL. Los dos
-- caminos del cliente (RPC portal + sync landing) setean el flag y además la
-- certeza explícita → el trigger los saltea y su 'declarado' queda firme.
-- El edge de re-verificación TRAMIX (F2B) no cambia la fecha en el caso "match"
-- (sólo sube la certeza), así que no dispara este trigger.
--
-- Reglas: R16 (firmas idénticas), R17 (SECDEF).

-- ───────────────────────────────────────────────────────────────────────────
-- A) Trigger que fija la certeza por defecto en escrituras oficiales de la fecha
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_venc_certeza_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.matricula_rpac_vencimiento IS DISTINCT FROM OLD.matricula_rpac_vencimiento
     AND COALESCE(current_setting('app.venc_declarado', true), '') <> 'on' THEN
    -- Camino oficial/sistema (cierre de trámite, tracking, gerencia): el dato es
    -- confiable → certeza NULL (el get la lee como 'confirmado'), origen gerencia,
    -- y se limpia una verificación TRAMIX previa.
    NEW.matricula_rpac_vencimiento_certeza := NULL;
    NEW.matricula_rpac_vencimiento_origen := 'gerencia';
    NEW.matricula_rpac_vencimiento_verificado_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_admin_venc_certeza_default ON public.administraciones;
CREATE TRIGGER trg_admin_venc_certeza_default
  BEFORE UPDATE OF matricula_rpac_vencimiento ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.admin_venc_certeza_default();

-- ───────────────────────────────────────────────────────────────────────────
-- B) RPC PORTAL — flag de cliente antes del UPDATE (el trigger lo saltea)
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

  -- DGG-218 F2A #2: marca el statement como "camino de cliente" → el trigger
  -- trg_admin_venc_certeza_default NO resetea la certeza declarada.
  PERFORM set_config('app.venc_declarado', 'on', true);

  UPDATE public.administraciones
     SET matricula_rpac_vencimiento = p_fecha,
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
-- C) SYNC LANDING — mismo flag antes del UPDATE
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

  -- DGG-218 F2A #2: si va a rellenar el vencimiento, marca el statement como
  -- "camino de cliente" para que el trigger no pise la certeza 'declarado'.
  IF v_venc IS NOT NULL THEN
    PERFORM set_config('app.venc_declarado', 'on', true);
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
