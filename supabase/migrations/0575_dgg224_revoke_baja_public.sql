-- 0575 · DGG-224 §6 fix — least-privilege real en las RPC de baja (R6).
--
-- El §6 (3 agentes) encontró que el REVOKE de la mig 0574
--   REVOKE EXECUTE ... FROM anon, authenticated
-- era INEFECTIVO para administracion_baja: el grant venía por **PUBLIC** (ACL
-- `=X/postgres`), no por grants explícitos a esos roles → anon/authenticated
-- conservaban EXECUTE vía PUBLIC. No era explotable (el baja_token de 128 bits
-- es la barrera y la RLS impide leer tokens ajenos), pero el control documentado
-- no existía: la SECDEF era invocable por PostgREST sin pasar por el edge.
--
-- prospecto_baja (DGG-220, mig 0545) tenía grants EXPLÍCITOS a anon+authenticated
-- → mismo lockdown por consistencia. Verificado: el frontend NO llama ninguna de
-- las dos por RPC (solo aparecen en los types generados); el único invocador es
-- el edge email-baja, que usa service_role (conserva su grant explícito).
--
-- Patrón correcto para SECDEF service_role-only: REVOKE FROM PUBLIC (no de roles
-- concretos, que deja pasar el grant default a PUBLIC).

REVOKE EXECUTE ON FUNCTION public.administracion_baja(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prospecto_baja(uuid, text)       FROM PUBLIC, anon, authenticated;
