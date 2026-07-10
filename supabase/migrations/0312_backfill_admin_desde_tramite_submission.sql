-- 0312 · Reporte JL (punto 4, path PÚBLICO) · Cuando el cliente carga sus datos en
-- un formulario PÚBLICO (no logueado) y la gerencia lo activa, `solicitud_activar`
-- crea la administración pero NO copia responsable/padre/madre/dni/dirección/etc.
-- desde la submission → la ficha sale "Sin asignar" (JL: pasa en TODOS los que
-- generó así). El sync de submission no alcanza porque la submission pública nace
-- con administracion_id NULL (short-circuita).
--
-- Fix (sin tocar el crítico `solicitud_activar`): un trigger AFTER INSERT en
-- `tramites` que, cuando el trámite queda ligado a una admin Y a una submission
-- (`formulario_submission_id`), backfillea la ficha de la admin desde los datos de
-- esa submission (mismo mapeo que `sync_submission_a_administracion`, COALESCE →
-- sólo rellena NULLs). Cubre el path público Y cualquier otro que ligue trámite a
-- submission. SECURITY DEFINER (escribe en administraciones con RLS — R17).
CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_cuit   := NULLIF(trim(v_datos->>'cuit'), '');
  v_tel    := COALESCE(NULLIF(trim(v_datos->>'celular'), ''), NULLIF(trim(v_datos->>'telefono'), ''));
  v_nombre   := NULLIF(trim(v_datos->>'nombre'), '');
  v_apellido := NULLIF(trim(v_datos->>'apellido'), '');
  v_dni      := NULLIF(trim(v_datos->>'dni'), '');
  v_whatsapp := COALESCE(NULLIF(trim(v_datos->>'whatsapp'), ''), NULLIF(trim(v_datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(v_datos->>'calle'), ''),
    NULLIF(trim(v_datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(v_datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(v_datos->>'piso') END,
    CASE WHEN NULLIF(trim(v_datos->>'depto'), '') IS NOT NULL THEN 'Depto ' || trim(v_datos->>'depto') END
  )), '');

  UPDATE public.administraciones
  SET
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

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_tramite_backfill_admin ON public.tramites;
CREATE TRIGGER trg_tramite_backfill_admin
  AFTER INSERT ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.backfill_admin_desde_tramite_submission();
