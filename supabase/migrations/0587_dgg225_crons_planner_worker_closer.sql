-- 0587 · DGG-225 · Crons del rediseño: PLANNER + WORKER + reschedule del CLOSER
-- =============================================================================
-- Encadena las 3 fases hands-off (convención del repo: 10:00 ART = 13:00 UTC):
--
--   PLANNER  '0 13 * * *'        (10:00 ART) → agente_cierre_planificar()
--            encola los legajos de los candidatos principales del día. No cierra.
--
--   WORKER   '5-55/5 13-18 * * *' (10:05–15:55 ART, 71 ticks) guardado por EXISTS
--            pendientes → net.http_post a la edge tramix-cierre-scrape. 1 legajo
--            cada 5 min (~0,2 req/min, más lento que el sancionado ~1/min). Escribe
--            tramix_cache fresco del día. Breaker + SKIP LOCKED protegen la IP.
--            Arranca a :05 (no :00) para darle al PLANNER 5 min de ventaja y que su
--            DELETE no pise un scrape en curso (§6 A#16).
--
--   CLOSER   '10 19 * * *'       (16:10 ART) → reschedule del cron EXISTENTE
--            agente-cierre-tramites-diario (estaba a '0 13'). Corre DESPUÉS de drenar
--            la ventana de scraping → cierra sólo lo que se refrescó HOY (fresco=hoy,
--            mig 0586) + reporte consolidado. Lo no refrescado cascada a mañana.
-- =============================================================================

-- PLANNER
SELECT cron.unschedule('tramix-cierre-planner')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='tramix-cierre-planner');
SELECT cron.schedule('tramix-cierre-planner', '0 13 * * *',
  $cron$ SELECT public.agente_cierre_planificar(); $cron$);

-- WORKER (1 legajo cada 5 min, 10:00–15:55 ART; sólo si hay pendientes)
SELECT cron.unschedule('tramix-cierre-scrape-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='tramix-cierre-scrape-tick');
SELECT cron.schedule(
  'tramix-cierre-scrape-tick',
  '5-55/5 13-18 * * *',
  $cron$
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.tramix_cierre_refresh_queue
      WHERE estado = 'pendiente'
         OR (estado = 'procesando' AND updated_at < now() - interval '15 minutes')
    ) THEN
      PERFORM net.http_post(
        url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/tramix-cierre-scrape',
        headers := jsonb_build_object('Content-Type','application/json','Authorization', private.cron_bearer()),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    END IF;
  END $$;
  $cron$
);

-- CLOSER: mover el cron diario existente de 10:00 a 16:10 ART (corre tras el scraping)
SELECT cron.unschedule('agente-cierre-tramites-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agente-cierre-tramites-diario');
SELECT cron.schedule('agente-cierre-tramites-diario', '10 19 * * *',
  $cron$ SELECT public.agente_cierre_correr('cron'); $cron$);
