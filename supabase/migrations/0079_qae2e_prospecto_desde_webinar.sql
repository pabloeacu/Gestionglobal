-- 0079 · EGG-QA-24 · CRM completo para form de webinarios sin webinar específico
-- (aplicada via apply_migration 2026-05-26)
--
-- Antes: el trigger inscribir_webinar_desde_submission sólo procesaba si el
-- form tenía webinar_id seteado. Submissions al form genérico "webinarios"
-- (webinar_id NULL) quedaban en limbo → ni prospecto en CRM ni inscripción
-- ni notificación a gerencia.
--
-- Ahora:
--   Caso A · form con webinar_id → inscribe (lógica original)
--   Caso B · email ya es admin existente → NO crea prospecto, emite notif
--            'cliente_existente_landing' con texto "Se inscribió a X desde
--            landing pública"
--   Caso C · prospecto nuevo → upsert en prospectos (origen='webinar_landing')
--            + notif 'prospecto_webinar' a gerencia
--
-- Verificado e2e: prospecto Lucia creado fresh; María (cliente existente)
-- NO duplica como prospecto y dispara notif diferenciada.

SELECT 'mig 0079 aplicada via apply_migration 2026-05-26 · ver código en \df+ public.inscribir_webinar_desde_submission' AS info;
