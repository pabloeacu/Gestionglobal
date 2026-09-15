-- 0480 · Auditoría 2026-09 · MEDIO: alta-cliente-portal escalaba mal (listUsers cap 200).
--
-- HALLAZGO (revisión adversarial de C2): la edge fn alta-cliente-portal buscaba un
-- usuario existente con `admin.auth.admin.listUsers({page:1, perPage:200})` + find()
-- por email. Hoy hay ~109 usuarios; pasando 200, un usuario en la página 2+ NO se
-- encontraría → el alta de un cliente YA existente fallaría (createUser 'already
-- registered' o el 409 anti-secuestro). Falla CERRADA (sin hueco de seguridad) pero
-- rompe el provisioning legítimo a escala.
--
-- FIX: lookup EXACTO por email vía RPC SECURITY DEFINER, indexado sobre auth.users,
-- llamable SÓLO por service_role (la edge fn). No enumera usuarios (devuelve sólo el
-- id o NULL) y no queda expuesta a anon/authenticated.

CREATE OR REPLACE FUNCTION public.gg_auth_user_id_por_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
STABLE
AS $function$
  SELECT id FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  ORDER BY created_at ASC
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.gg_auth_user_id_por_email(text) IS
  'Devuelve el id del usuario auth con ese email (o NULL). SÓLO service_role (edge fns). '
  'Reemplaza el listUsers(perPage:200) de alta-cliente-portal (mig 0480, no enumera usuarios).';

-- Sólo service_role: revocar el default de Supabase (anon/authenticated/PUBLIC) para
-- que ningún cliente pueda resolver emails → ids (enumeración).
REVOKE EXECUTE ON FUNCTION public.gg_auth_user_id_por_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_auth_user_id_por_email(text) TO service_role;
