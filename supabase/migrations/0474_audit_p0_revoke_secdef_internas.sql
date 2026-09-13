-- AUDITORÍA 2026-09 · Fase 1 (P0 seguridad, riesgo cero) · Hallazgo A1 (clase T1)
-- REVOKE EXECUTE de funciones SECURITY DEFINER internas/cron/webhook que quedaron
-- ejecutables por anon/authenticated vía PostgREST (/rest/v1/rpc) sin guard interno.
--
-- VERIFICADO antes de aplicar (2026-09-13, ventana sin usuarios):
--   * 0 callers de front: cada nombre aparece SOLO en src/types/database.ts (tipos
--     generados), 0 llamadas .rpc('<fn>') reales en src/.
--   * Callers legítimos y su rol (NO afectados por revocar anon/authenticated):
--       - cron (pg_cron corre como 'postgres', dueño): reset_arca_jobs_colgados,
--         gg_agenda_procesar_recordatorios.
--       - edge fn con service_role: webex-webhook (webex_*), health-flows-check
--         (health_flow_alerts_garbage_collect). service_role conserva EXECUTE.
--       - helpers internos llamados por otras funciones SECURITY DEFINER (corren
--         como owner): notificar_usuario, admin_login_email,
--         _comunicacion_resolver_audiencia.
--
-- RIESGO CERRADO: phishing por push/campanita (notificar_usuario), fuga de PII
-- cross-tenant (admin_login_email, _comunicacion_resolver_audiencia), fraude de
-- asistencia/certificados (webex_*), interferencia con el pipeline AFIP y el
-- monitoreo (reset_arca_jobs_colgados, health_flow_alerts_garbage_collect,
-- gg_agenda_procesar_recordatorios).
--
-- 100% REVERSIBLE: para restaurar una función, GRANT EXECUTE ON FUNCTION
-- public.<fn>(<args>) TO authenticated;  (ninguna necesitaba el grant).

REVOKE EXECUTE ON FUNCTION public.notificar_usuario(uuid, text, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_login_email(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._comunicacion_resolver_audiencia(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_arca_jobs_colgados(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gg_agenda_procesar_recordatorios() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.health_flow_alerts_garbage_collect() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webex_encuentro_started(text, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webex_encuentro_ended(text, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webex_participant_joined(text, uuid, timestamptz, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webex_participant_left(text, uuid, timestamptz) FROM anon, authenticated;
