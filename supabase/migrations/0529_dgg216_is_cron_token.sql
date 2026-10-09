-- 0529_dgg216_is_cron_token.sql
-- DGG-216 · Verificador del bearer de cron, para que la edge `tramix-backfill`
-- (verify_jwt=false) sólo acepte llamadas de la cron, que pasa
-- Authorization := private.cron_bearer() (= 'Bearer ' + cron_secret del vault).
CREATE OR REPLACE FUNCTION public.is_cron_token(p_token text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'cron_secret' AND decrypted_secret = p_token
  );
$fn$;
REVOKE EXECUTE ON FUNCTION public.is_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_cron_token(text) TO service_role;
