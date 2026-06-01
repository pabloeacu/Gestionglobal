-- 0162 · CRON_SECRET realignment para dispatch-emails / push / arca
--                E-GG-27 (sistema asíncrono caído desde AUDIT-011)
--
-- Aplicada el 2026-06-01 (via apply_migration + acción manual usuario en
-- Supabase Dashboard → Edge Functions → Secrets).
--
-- Diagnóstico: AUDIT-011 (Fase 5) endureció dispatch-emails, dispatch-push y
-- dispatch-arca-emission para exigir Authorization Bearer = CRON_SECRET o
-- SUPABASE_SERVICE_ROLE_KEY. Los pg_cron jobs usaban
-- current_setting('app.service_role_key', true) que estaba NULL (nunca
-- seteado) → cron mandaba Bearer vacío → 401 en cada tick desde la fecha
-- de AUDIT-011 (~3 días sin enviar emails, push ni autorizar ARCA).
--
-- Por qué nadie detectó: los logs eran "200 OK" del cron pg_cron (porque
-- net.http_post no falla; el cron job mismo no chequea el body de respuesta
-- del POST a la edge fn). El 401 vivía adentro del log de la edge fn, que
-- no se monitoreaba.
--
-- Fix:
-- 1. Generado nuevo CRON_SECRET: gg_cron_c3500aaaf64c4304bd4f775d3b141136
-- 2. Hardcoded el bearer en cada cron job (ALTER DATABASE no permitido en
--    Supabase managed para settings app.*).
-- 3. El usuario lo seteó en Supabase Dashboard → Edge Functions → Secrets
--    → CRON_SECRET = mismo valor. Al guardarlo, Supabase re-deployó
--    automáticamente las 3 edge fns.
-- 4. Verificación: dispatch-emails respondió {"ok":true,"throttled":true}
--    al primer tick post-fix. Los emails encolados de E-GG-26 (3 pending)
--    están siendo procesados con throttle 5min entre envíos.

DO $$
DECLARE
  v_job record;
  v_secret text := 'gg_cron_c3500aaaf64c4304bd4f775d3b141136';
BEGIN
  FOR v_job IN SELECT jobid, jobname FROM cron.job
               WHERE jobname IN ('dispatch-emails-1min','dispatch-push-2min','arca-dispatch-every-min')
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      command := CASE v_job.jobname
        WHEN 'dispatch-emails-1min' THEN format($f$
          SELECT net.http_post(
            url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-emails',
            headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
            body := '{}'::jsonb
          );
        $f$, v_secret)
        WHEN 'dispatch-push-2min' THEN format($f$
          SELECT net.http_post(
            url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-push',
            headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
            body := '{}'::jsonb
          );
        $f$, v_secret)
        WHEN 'arca-dispatch-every-min' THEN format($f$
          SELECT net.http_post(
            url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-arca-emission',
            headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
            body := '{}'::jsonb
          );
        $f$, v_secret)
      END
    );
    RAISE NOTICE 'Updated cron job: % (id=%)', v_job.jobname, v_job.jobid;
  END LOOP;
END $$;
