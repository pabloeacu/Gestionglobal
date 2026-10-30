-- 0622_dgg221_revoke_secdef_captacion.sql
-- DGG-221 · Hardening capitalizado del §6 (advisor de seguridad) sobre mig 0621.
-- --------------------------------------------------------------------------
-- Las 2 funciones SECURITY DEFINER nuevas de 0621 nacieron con el EXECUTE por
-- default a PUBLIC/anon/authenticated. El watcher es sensible (si lo llamara un
-- usuario y la cola de scraping estuviera drenada, REANUDARÍA el motor de
-- envíos). Se las baja al mismo perfil que el resto de la familia de captación
-- (`prospectos_campana_tick`, `prospecto_tramix_claim`): sólo postgres (la cron
-- corre como superuser y no mira estos grants) + service_role. Mismo patrón B1
-- de DGG-231 / mig 0601. Idempotente.
-- --------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.prospectos_revisita_en_tramite() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prospectos_reverify_watcher()   FROM PUBLIC, anon, authenticated;
