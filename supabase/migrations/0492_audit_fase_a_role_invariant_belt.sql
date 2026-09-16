-- 0492 · Fase A · Etapa 2: invariante "el rol/tenant/partner sólo lo cambia gerencia o el sistema", en la BD.
-- C1 (mig 0475) ya quitó el grant de UPDATE sobre role/administracion_id/partner_id a authenticated (sólo
-- puede editar avatar_url/full_name/phone). Este trigger es DEFENSA EN PROFUNDIDAD: aunque en el futuro se
-- ensanchara el grant por error, un usuario final (authenticated/anon) no puede mutar esas 3 columnas.
-- SECURITY INVOKER (no DEFINER) para ver el current_user REAL del que hace el statement:
--   · UPDATE directo por PostgREST → current_user='authenticated'/'anon' → si cambia una col protegida, 42501.
--   · RPC SECURITY DEFINER (actualizar_gerente, fusionar_administraciones, administracion_dar_de_baja/reactivar,
--     etc.) corre como owner (postgres) → permitido. · service_role (edges) → permitido. · handle_new_user es
--     INSERT (este trigger es BEFORE UPDATE) → no aplica.
CREATE OR REPLACE FUNCTION private.profiles_guard_privilegios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.administracion_id IS DISTINCT FROM OLD.administracion_id
      OR NEW.partner_id IS DISTINCT FROM OLD.partner_id)
     AND current_user IN ('authenticated', 'anon')
  THEN
    RAISE EXCEPTION 'No autorizado: role/administracion_id/partner_id sólo los cambia gerencia o el sistema'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $fn$;

REVOKE ALL ON FUNCTION private.profiles_guard_privilegios() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_guard_privilegios ON public.profiles;
CREATE TRIGGER trg_profiles_guard_privilegios
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.profiles_guard_privilegios();
