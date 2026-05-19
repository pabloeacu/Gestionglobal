-- ============================================================================
-- 0001a_security_fixes · respuesta al linter de Supabase post-0001.
--   1) SET search_path a touch_updated_at (function_search_path_mutable).
--   2) REVOKE EXECUTE de funciones SECURITY DEFINER a anon / public donde no
--      corresponde RPC desde el cliente (anon_security_definer_function_executable,
--      authenticated_security_definer_function_executable).
--
-- Diseño:
--   · Triggers (handle_new_user, audit_row, touch_updated_at): nunca se llaman
--     por RPC directo; corren por el trigger con privilegios del definer.
--     → REVOKE de PUBLIC, anon, authenticated.
--   · Helpers de rol/RLS (get_user_role, is_*, current_administracion_id):
--     el motor de RLS los necesita para `authenticated`; los bloqueamos a anon.
--   · assert_administracion_access: sólo se invoca desde otras RPC SD nuestras;
--     no debe ser llamable directamente por el cliente. REVOKE total.
-- ============================================================================

-- 1) Fix search_path mutable
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 2) REVOKE EXECUTE — funciones que NUNCA se invocan por RPC
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_row()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_administracion_access(uuid)
                                                                FROM PUBLIC, anon, authenticated;

-- 3) REVOKE EXECUTE — helpers RLS: necesarios para `authenticated` (los usa el
--    motor de RLS), pero no para `anon`.
REVOKE EXECUTE ON FUNCTION public.get_user_role()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_gerente()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_operador()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_administrador()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff()                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_administracion_id()  FROM PUBLIC, anon;
