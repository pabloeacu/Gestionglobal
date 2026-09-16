-- 0494 · Auditoría 2026-09 · FASE A / A2: sacar CRON_SECRET de los comandos de cron → leerlo de Vault.
--
-- Problema (A2/T4 del informe): el CRON_SECRET (`gg_cron_c3500…`) está HARDCODEADO en 8 cron jobs y quedó
-- COMMITEADO en el repo (migs 0162/0166/0373) → cualquiera con acceso al repo puede disparar las edge
-- (verify_jwt=false) llamadas por pg_cron (mails/push/ARCA masivos, DoS del throttle).
--
-- Fix (parte SQL, esta mig): los 8 crons dejan de hardcodear el bearer y lo leen en runtime de Vault vía
-- `private.cron_bearer()`. Así, ROTAR el valor = actualizar Vault (SQL) + Edge Functions→Secrets (panel),
-- SIN volver a tocar/commitear el secreto. El valor actual ya está seedeado en Vault (secret `cron_secret`,
-- fuera de migración para no re-filtrarlo). En un entorno nuevo, seedear `cron_secret` en Vault + el env
-- `CRON_SECRET` de las edge son config de entorno (no van en migraciones).
--
-- Zero-downtime: mientras Vault tenga el valor ACTUAL, `cron_bearer()` devuelve el MISMO Bearer que hoy →
-- los crons no cambian de comportamiento. La ROTACIÓN del valor (a uno nuevo, no filtrado) se hace después,
-- coordinando Vault + edge env.

-- Helper: devuelve 'Bearer <cron_secret de Vault>'. SECURITY DEFINER (lee vault como owner). Sólo cron/postgres.
CREATE OR REPLACE FUNCTION private.cron_bearer()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT 'Bearer ' || decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION private.cron_bearer() FROM PUBLIC, anon, authenticated;

-- Reescribir los 8 cron jobs (por nombre → replay-safe) para leer el bearer de Vault en vez de hardcodearlo.
DO $do$
DECLARE
  r record;
  specs jsonb := jsonb_build_object(
    'arca-dispatch-every-min',        'dispatch-arca-emission',
    'dispatch-emails-1min',           'dispatch-emails',
    'dispatch-push-2min',             'dispatch-push',
    'health-flows-check-12h',         'health-flows-check',
    'dispatch-vencimientos-diario',   'dispatch-vencimientos',
    'gg-email-bounces-30min',         'email-bounce-harvester',
    'db-health-alert-check-daily',    'db-health-alert-check',
    'gg-zoom-reconciliar-asistencia', 'zoom-reconciliar-asistencia'
  );
  k text; v text; v_jobid bigint; v_body text; v_timeout text; v_cmd text;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each_text(specs) LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = k;
    IF v_jobid IS NULL THEN CONTINUE; END IF;
    -- health-flows manda body {"origen":"cron"}; email-bounce-harvester tiene timeout de 60s; el resto {}.
    v_body := CASE WHEN k = 'health-flows-check-12h' THEN '{"origen":"cron"}' ELSE '{}' END;
    v_timeout := CASE WHEN k = 'gg-email-bounces-30min' THEN ', timeout_milliseconds := 60000' ELSE '' END;
    v_cmd := format(
      'SELECT net.http_post(url := %L, headers := jsonb_build_object(%L, %L, %L, private.cron_bearer()), body := %L::jsonb%s);',
      'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/' || v,
      'Content-Type', 'application/json',
      'Authorization',
      v_body, v_timeout
    );
    PERFORM cron.alter_job(v_jobid, command := v_cmd);
  END LOOP;
END $do$;
