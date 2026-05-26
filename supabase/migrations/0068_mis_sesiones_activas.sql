-- ============================================================================
-- 0068_mis_sesiones_activas · DGG-36 / P2-#35
--
-- Listar sesiones activas del usuario propio y permitir cerrarlas
-- individualmente. Útil para "estás conectado desde N dispositivos, cerrar
-- la del laptop viejo".
--
-- auth.sessions y auth.refresh_tokens están reservadas; sólo accesibles vía
-- SECURITY DEFINER con search_path = public, auth, pg_temp.
--
-- Nota tipos (E-GG-27 capítulo): `auth.sessions.refreshed_at` es
-- `timestamp without time zone`. Castear a `timestamptz AT TIME ZONE 'UTC'`
-- antes de devolverlo o la función falla con 42804.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mis_sesiones_activas()
RETURNS TABLE(
  id uuid,
  user_agent text,
  ip inet,
  created_at timestamptz,
  updated_at timestamptz,
  refreshed_at timestamptz,
  not_after timestamptz,
  es_actual boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  v_jwt jsonb;
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  BEGIN
    v_jwt := current_setting('request.jwt.claims', true)::jsonb;
    v_session_id := (v_jwt->>'session_id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_session_id := NULL;
  END;

  RETURN QUERY
  SELECT
    s.id,
    s.user_agent,
    s.ip,
    s.created_at::timestamptz,
    s.updated_at::timestamptz,
    (s.refreshed_at AT TIME ZONE 'UTC')::timestamptz,
    s.not_after::timestamptz,
    (s.id = v_session_id) AS es_actual
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
    AND (s.not_after IS NULL OR s.not_after > now())
  ORDER BY (s.id = v_session_id) DESC,
           COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.cerrar_mi_sesion(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT user_id INTO v_owner FROM auth.sessions WHERE id = p_session_id;
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  DELETE FROM auth.refresh_tokens WHERE session_id = p_session_id;
  DELETE FROM auth.sessions WHERE id = p_session_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mis_sesiones_activas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_mi_sesion(uuid) TO authenticated;
