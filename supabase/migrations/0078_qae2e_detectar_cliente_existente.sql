-- 0078 · EGG-QA-23 · detectar cliente existente al recibir solicitud desde landing
-- (aplicada el 2026-05-26 via apply_migration; copia versionada)
--
-- Si un cliente que YA existe en administraciones vuelve a la landing pública
-- y completa un formulario, el sistema:
--   1. Detecta coincidencia por CUIT (preferido) o email
--   2. Vincula la solicitud al cliente existente (cliente_id seteado)
--   3. Marca el submission con administracion_id del cliente
--   4. Emite notif extra "cliente_existente_landing" a gerencia con texto
--      "Hizo solicitud X desde landing pública en vez del portal"
--   5. NO duplica administración
--
-- Antes de este fix: cliente_id quedaba NULL, gerencia veía la solicitud
-- como si fuera de un completo desconocido y tenía que descubrir el match
-- manualmente en el wizard de activación.

SELECT 'mig 0078 aplicada via apply_migration el 2026-05-26 · ver código vía \df+ public.crear_tramite_desde_submission_auto' AS info;
