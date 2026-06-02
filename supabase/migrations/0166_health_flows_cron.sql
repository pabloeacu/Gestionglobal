-- 0166 · Cron para health-flows-check cada 12h (DGG-32)
--
-- Schedule: 0 3,15 * * * UTC = 00:00 y 12:00 ART (Argentina UTC-3).
-- El bearer es el mismo CRON_SECRET que usan los 3 dispatchers desde
-- mig 0162 (E-GG-27). Si ese secret se rota, hay que actualizar este job
-- en el mismo lote (es el mismo procedimiento).

DO $$
DECLARE
  v_secret text := 'gg_cron_c3500aaaf64c4304bd4f775d3b141136';
  v_jobname text := 'health-flows-check-12h';
  v_existing_id integer;
BEGIN
  SELECT jobid INTO v_existing_id FROM cron.job WHERE jobname = v_jobname;
  IF v_existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_id);
  END IF;

  PERFORM cron.schedule(
    job_name := v_jobname,
    schedule := '0 3,15 * * *',  -- 00:00 y 12:00 ART
    command := format($f$
      SELECT net.http_post(
        url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/health-flows-check',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"origen":"cron"}'::jsonb
      );
    $f$, v_secret)
  );

  RAISE NOTICE 'Cron job % programado: 0 3,15 * * *', v_jobname;
END $$;
