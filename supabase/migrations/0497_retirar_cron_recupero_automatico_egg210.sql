-- 0497 · Auditoría 2026-09 · DGG-186 / E-GG-210: retirar el cron de recupero AUTOMÁTICO.
--
-- Decisión de producto de Pablo (2026-09-17): "los impulsos de recupero SIEMPRE tienen que
-- ser manuales, decididos por el gerente". Por lo tanto el recupero automático diario no debe
-- existir.
--
-- Contexto (E-GG-210): el cron `dispatch-recupero-diario` (jobid 8, `30 12 * * *` = 09:30 AR)
-- hacía `net.http_post` a la edge `dispatch-recupero` SIN header Authorization — era el ÚNICO
-- http_post cron sin `private.cron_bearer()` → la edge (que valida Bearer CRON_SECRET
-- internamente) devolvía 401 TODOS los días. `dispatch_recupero_log` = 0 filas en toda la vida
-- de prod → el recupero automático NUNCA se ejecutó. Además ese 401 diario ensuciaba el
-- monitoreo (métrico `cron_http_fallas_24h` de 0496 lo contaba como falla → falsa alarma).
--
-- Fix: RETIRAR el cron (replay-safe). Alinea prod con "recupero solo manual" y limpia el
-- falso-positivo del panel de Salud. NO se toca el circuito MANUAL, que es el que se usa y anda:
--   - RPC `public.disparar_recupero_manual(uuid, smallint, text)` (la que dispara el gerente
--     desde DispararRecuperoDrawer) — INTACTA.
--   - tablas `recupero_acciones`, `recupero_config`, `recupero_no_duplicar` (guarda anti-dup) — INTACTAS.
-- Infra que queda huérfana (NO la desmantela esta mig, por si algún día se decide lo contrario):
-- edge fn `dispatch-recupero` (sólo la invocaba este cron; ahora nunca se llama). Se conserva.
--
-- Verificado antes de esta mig (read-only, DGG-186): reconciliación libro↔saldo_pendiente = 0
-- desviaciones en los 127 comprobantes; las 3 superficies de mora (comprobantes_morosos /
-- recupero_kpis / cuenta_corriente_morosos) cuadran en $3.010.000 / 17 admins en datos reales.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-recupero-diario') THEN
    PERFORM cron.unschedule('dispatch-recupero-diario');
  END IF;
END $$;
