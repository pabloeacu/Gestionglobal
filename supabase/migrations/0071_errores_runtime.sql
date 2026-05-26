-- ============================================================================
-- 0071_errores_runtime · DGG-38 / P2-#31
--
-- Sistema propio de error tracking (Sentry-like sin third-party).
--
-- Captura excepciones JS del frontend vía window.onerror y
-- unhandledrejection. Cada error se fingerprinttea (hash de msg+top stack
-- frame) y se UPSERT en la tabla agrupando ocurrencias.
--
-- Privacy: el usuario logueado queda asociado al error; sin auth, NULL.
-- Sólo staff puede leer la tabla. RPC capturar es callable por anon
-- (para errores en formularios públicos) y authenticated.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.errores_runtime (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint   text NOT NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message       text NOT NULL,
  stack         text,
  url           text,
  user_agent    text,
  payload       jsonb DEFAULT '{}'::jsonb,
  count         int NOT NULL DEFAULT 1,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  resuelto_at   timestamptz,
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_errores_last_seen ON public.errores_runtime(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_errores_fp ON public.errores_runtime(fingerprint);

ALTER TABLE public.errores_runtime ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS errores_staff_select ON public.errores_runtime;
CREATE POLICY errores_staff_select ON public.errores_runtime
  FOR SELECT USING (private.is_staff());

DROP POLICY IF EXISTS errores_staff_update ON public.errores_runtime;
CREATE POLICY errores_staff_update ON public.errores_runtime
  FOR UPDATE USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE OR REPLACE FUNCTION public.errores_capturar(
  p_fingerprint text, p_message text,
  p_stack text DEFAULT NULL, p_url text DEFAULT NULL,
  p_user_agent text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_user uuid;
BEGIN
  v_user := auth.uid();
  IF p_fingerprint IS NULL OR p_message IS NULL THEN RETURN NULL; END IF;
  p_message := LEFT(p_message, 2000);
  p_stack := LEFT(coalesce(p_stack, ''), 8000);
  p_url := LEFT(coalesce(p_url, ''), 500);
  p_user_agent := LEFT(coalesce(p_user_agent, ''), 500);

  INSERT INTO public.errores_runtime(
    fingerprint, user_id, message, stack, url, user_agent, payload
  ) VALUES (
    p_fingerprint, v_user, p_message, p_stack, p_url, p_user_agent,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (user_id, fingerprint) DO UPDATE SET
    count = errores_runtime.count + 1,
    last_seen = now(),
    resuelto_at = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.errores_listar(
  p_limit int DEFAULT 50, p_solo_no_resueltos boolean DEFAULT true
) RETURNS TABLE(
  id uuid, fingerprint text, message text, stack text, url text,
  user_agent text, user_id uuid, user_email text,
  count int, first_seen timestamptz, last_seen timestamptz,
  resuelto_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.fingerprint, e.message, e.stack, e.url,
         e.user_agent, e.user_id,
         (SELECT u.email FROM auth.users u WHERE u.id = e.user_id) AS user_email,
         e.count, e.first_seen, e.last_seen, e.resuelto_at
  FROM public.errores_runtime e
  WHERE private.is_staff()
    AND (NOT p_solo_no_resueltos OR e.resuelto_at IS NULL)
  ORDER BY e.last_seen DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1);
$$;

CREATE OR REPLACE FUNCTION public.errores_marcar_resuelto(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  UPDATE public.errores_runtime SET resuelto_at = now() WHERE id = p_id;
  RETURN FOUND;
END; $$;

GRANT EXECUTE ON FUNCTION public.errores_capturar(text, text, text, text, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.errores_listar(int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.errores_marcar_resuelto(uuid) TO authenticated;
