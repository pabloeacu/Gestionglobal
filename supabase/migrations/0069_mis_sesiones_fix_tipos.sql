-- Fix HOTFIX: auth.sessions.refreshed_at es 'timestamp' (sin tz). Casteamos.
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

GRANT EXECUTE ON FUNCTION public.mis_sesiones_activas() TO authenticated;
