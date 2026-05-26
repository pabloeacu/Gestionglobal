-- 0081 · Panel de usuarios + telemetría PWA / push / último login
-- (aplicada via apply_migration 2026-05-26; este archivo cubre regla 6 / versionado)

-- 1) Columnas de telemetría PWA en profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pwa_installed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pwa_last_seen_at timestamptz;

COMMENT ON COLUMN public.profiles.pwa_installed_at IS 'Cuando el browser reportó display-mode=standalone por primera vez (PWA instalada).';
COMMENT ON COLUMN public.profiles.pwa_last_seen_at IS 'Última vez que el cliente reportó actividad desde la PWA (heartbeat).';

-- 2) RPC para que el cliente marque su instalación PWA
CREATE OR REPLACE FUNCTION public.gg_profile_marcar_pwa(p_installed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.profiles
     SET pwa_installed_at = COALESCE(pwa_installed_at, CASE WHEN p_installed THEN now() END),
         pwa_last_seen_at = CASE WHEN p_installed THEN now() ELSE pwa_last_seen_at END
   WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.gg_profile_marcar_pwa(boolean) TO authenticated;

-- 3) RPC para listar usuarios (solo gerentes ven todo)
CREATE OR REPLACE FUNCTION public.gestion_usuarios_listar()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  administracion_id uuid,
  administracion_nombre text,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  pwa_installed_at timestamptz,
  pwa_last_seen_at timestamptz,
  push_activo boolean,
  push_subs_count integer,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp', 'auth'
STABLE
AS $$
  SELECT
    p.id AS user_id,
    u.email,
    COALESCE(p.full_name, split_part(u.email, '@', 1)) AS full_name,
    p.role,
    p.administracion_id,
    a.nombre AS administracion_nombre,
    u.last_sign_in_at,
    (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
    p.pwa_installed_at,
    p.pwa_last_seen_at,
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.id) AS push_activo,
    (SELECT count(*)::int FROM public.push_subscriptions ps WHERE ps.user_id = p.id) AS push_subs_count,
    u.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.administraciones a ON a.id = p.administracion_id
  WHERE private.is_staff()  -- sólo staff puede listar
  ORDER BY p.role, u.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.gestion_usuarios_listar() TO authenticated;

COMMENT ON FUNCTION public.gestion_usuarios_listar() IS
  'Listado completo de usuarios con telemetría PWA + push + último login. Sólo accesible para staff.';

-- 4) RPC para eliminar gerente (solo gerente puede eliminar a OTRO gerente; nunca a sí mismo)
CREATE OR REPLACE FUNCTION public.gestion_gerente_eliminar(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp', 'auth'
AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'No podés eliminarte a vos mismo' USING ERRCODE = '22023'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IS DISTINCT FROM 'gerente' THEN
    RAISE EXCEPTION 'Solo se eliminan usuarios con rol gerente desde este panel' USING ERRCODE = '22023';
  END IF;
  -- Borrar profile (cascadeado por trigger ON DELETE CASCADE) y el user de auth
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.gestion_gerente_eliminar(uuid) TO authenticated;
