-- ============================================================================
-- 0001b_helpers_to_private · mueve los helpers RLS a un schema NO expuesto
-- por PostgREST (`private`), eliminando los 6 warnings residuales
-- `authenticated_security_definer_function_executable`.
--
-- Patrón Supabase recomendado: el motor de RLS evalúa las funciones con el
-- rol del request (authenticated), por lo que ese rol necesita EXECUTE.
-- Pero el schema `private` NO está en `api.schemas` de Supabase → no se
-- expone vía /rest/v1/rpc, y desaparece el warning.
--
-- Cita: P-DB-05 (helpers SECURITY DEFINER STABLE), bagaje doc 01 §4 (helpers).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------
-- Helpers (mismas firmas y cuerpos que en 0001, ahora en `private`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.get_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.is_gerente()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT private.get_user_role() = 'gerente'; $$;

CREATE OR REPLACE FUNCTION private.is_operador()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT private.get_user_role() = 'operador'; $$;

CREATE OR REPLACE FUNCTION private.is_administrador()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT private.get_user_role() = 'administrador'; $$;

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT private.get_user_role() IN ('gerente','operador'); $$;

CREATE OR REPLACE FUNCTION private.current_administracion_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT administracion_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.assert_administracion_access(p_administracion_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF private.is_staff() THEN
    RETURN;
  END IF;
  IF private.current_administracion_id() = p_administracion_id THEN
    RETURN;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Acceso denegado a la administración solicitada.';
END;
$$;

-- ---------------------------------------------------------------------------
-- Permisos: el rol `authenticated` necesita USAGE en el schema y EXECUTE
-- en las funciones (para que RLS pueda evaluarlas). PostgREST NO expone
-- `private` (no está en api.schemas), por lo que /rest/v1/rpc no las muestra.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_user_role()             TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_gerente()                TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_operador()               TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_administrador()          TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_staff()                  TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_administracion_id() TO authenticated;
-- assert_administracion_access: sólo usable desde otras RPC SD (no la usa RLS).
REVOKE EXECUTE ON FUNCTION private.assert_administracion_access(uuid)
                                                              FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-cablear policies que usaban public.is_staff() / public.is_gerente().
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (private.is_staff() OR id = auth.uid());

DROP POLICY IF EXISTS config_global_update_gerente ON public.config_global;
CREATE POLICY config_global_update_gerente ON public.config_global
  FOR UPDATE TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

DROP POLICY IF EXISTS auditoria_select_staff ON public.auditoria_cambios;
CREATE POLICY auditoria_select_staff ON public.auditoria_cambios
  FOR SELECT TO authenticated USING (private.is_staff());

-- ---------------------------------------------------------------------------
-- Eliminar las versiones en public (ya no se usan).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.assert_administracion_access(uuid);
DROP FUNCTION IF EXISTS public.current_administracion_id();
DROP FUNCTION IF EXISTS public.is_staff();
DROP FUNCTION IF EXISTS public.is_administrador();
DROP FUNCTION IF EXISTS public.is_operador();
DROP FUNCTION IF EXISTS public.is_gerente();
DROP FUNCTION IF EXISTS public.get_user_role();
