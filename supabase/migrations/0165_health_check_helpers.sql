-- 0165 · Helpers de introspección para health-flows-check (DGG-32)
--
-- Estas RPCs son llamadas desde la edge fn `health-flows-check`. Cada una
-- inspecciona un aspecto del schema (cron, triggers, definición de fns).
-- Son SECURITY DEFINER + grant solo a service_role para que no expongan
-- internas vía cualquier session autenticada.

-- ============================================================================
-- 1. health_check_cron_jobs_status(p_jobnames text[])
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_check_cron_jobs_status(
  p_jobnames text[]
)
RETURNS TABLE (jobname text, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT j.jobname, j.active
  FROM cron.job j
  WHERE j.jobname = ANY(p_jobnames);
END $$;

REVOKE ALL ON FUNCTION public.health_check_cron_jobs_status(text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_check_cron_jobs_status(text[]) TO service_role;
COMMENT ON FUNCTION public.health_check_cron_jobs_status(text[]) IS
  'Health check helper: devuelve el active flag de los cron jobs solicitados.';

-- ============================================================================
-- 2. health_check_trigger_existe(p_table, p_trigger_name_like)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_check_trigger_existe(
  p_table text,
  p_trigger_name_like text
)
RETURNS TABLE (trigger_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT t.tgname::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = p_table
    AND n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname LIKE p_trigger_name_like;
END $$;

REVOKE ALL ON FUNCTION public.health_check_trigger_existe(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_check_trigger_existe(text, text) TO service_role;
COMMENT ON FUNCTION public.health_check_trigger_existe(text, text) IS
  'Health check helper: lista triggers no-internos en una tabla que matchean un LIKE.';

-- ============================================================================
-- 3. health_check_fn_contains(p_schema, p_fn_name, p_needle)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_check_fn_contains(
  p_schema text,
  p_fn_name text,
  p_needle text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = p_schema AND p.proname = p_fn_name
  LIMIT 1;

  IF v_def IS NULL THEN
    RETURN false;
  END IF;
  RETURN position(p_needle IN v_def) > 0;
END $$;

REVOKE ALL ON FUNCTION public.health_check_fn_contains(text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_check_fn_contains(text, text, text) TO service_role;
COMMENT ON FUNCTION public.health_check_fn_contains(text, text, text) IS
  'Health check helper: verifica si una fn (schema.fn_name) contiene un string en su body.';
