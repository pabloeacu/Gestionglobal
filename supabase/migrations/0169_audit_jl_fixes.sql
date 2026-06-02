-- 0169 · Fixes de auditoría E-GG-32 (Jose Luis):
--   #1 Trigger sync submission → administraciones (COALESCE; nunca sobrescribe).
--   #5 Marca clave_fiscal_arca como sensitive en los 3 schemas que la usan.
--   #9 RPC pública `get_public_whatsapp()` (anon-callable sin abrir RLS).

-- #1 · Trigger sync submission → administraciones
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text;
  v_matric text; v_cuit text; v_tel text;
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := NULLIF(trim(NEW.datos->>'matricula_rpac'), '');
  v_cuit   := NULLIF(trim(NEW.datos->>'cuit'), '');
  v_tel    := COALESCE(
    NULLIF(trim(NEW.datos->>'celular'), ''),
    NULLIF(trim(NEW.datos->>'telefono'), '')
  );

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL
     AND v_clave IS NULL AND v_matric IS NULL AND v_cuit IS NULL
     AND v_tel IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.administraciones SET
    padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
    madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
    legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
    clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
    matricula_rpac        = COALESCE(matricula_rpac, v_matric),
    cuit                  = COALESCE(cuit, v_cuit),
    telefono              = COALESCE(telefono, v_tel),
    updated_at            = now()
  WHERE id = NEW.administracion_id;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.sync_submission_a_administracion() IS
  'AJL-1 · Absorbe datos personales de una submission a la ficha de la administración (COALESCE; nunca sobrescribe).';

DROP TRIGGER IF EXISTS trg_subm_sync_admin ON public.formulario_submissions;
CREATE TRIGGER trg_subm_sync_admin
  AFTER INSERT ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.sync_submission_a_administracion();

-- #5 · Sensitive flag para clave_fiscal_arca en los 3 schemas
UPDATE public.formularios SET schema = jsonb_set(
  schema, '{sections}',
  (SELECT jsonb_agg(
    CASE WHEN section->'fields' IS NULL THEN section
    ELSE jsonb_set(section, '{fields}',
      (SELECT jsonb_agg(
         CASE WHEN field->>'name' = 'clave_fiscal_arca'
           THEN field || jsonb_build_object('sensitive', true)
         ELSE field END
       ) FROM jsonb_array_elements(section->'fields') field)
    ) END
  ) FROM jsonb_array_elements(schema->'sections') section)
)
WHERE slug IN ('matriculacion-rpac','renovacion-rpac','certificado-rpac');

-- #9 · RPC pública whatsapp
CREATE OR REPLACE FUNCTION public.get_public_whatsapp()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT whatsapp FROM public.config_global WHERE id = 1
$$;

REVOKE ALL ON FUNCTION public.get_public_whatsapp() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_whatsapp() TO anon, authenticated;
COMMENT ON FUNCTION public.get_public_whatsapp() IS
  'AJL-1 · Devuelve config_global.whatsapp sin abrir RLS de la tabla. Lo usa el WhatsAppFloatingButton.';
