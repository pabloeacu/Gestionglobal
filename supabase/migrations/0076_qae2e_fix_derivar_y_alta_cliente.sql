-- 0076 · EGG-QA-10 + EGG-QA-11 · fix wizard de activación
-- (aplicada el 2026-05-26 via apply_migration; copia versionada)
--
-- EGG-QA-11: solicitud_derivar llamaba a generar_acceso_externo con args en
-- posición incorrecta (le pasaba 7 como p_nombre_destinatario en vez de
-- p_dias_validez). La excepción quedaba silenciada por EXCEPTION WHEN OTHERS
-- NULL → el token NUNCA se generaba pero el email salía con URL fallback.
-- Fix: named args + RAISE WARNING (no silencioso).
--
-- EGG-QA-10: solicitud_activar creaba la administración pero NO un user en
-- auth.users → el cliente nuevo no podía loguearse pese a recibir email
-- "bienvenida-administracion" con credenciales falsas. Fix: el RPC ya NO
-- encola bienvenida para clientes nuevos; el trigger trg_admin_provision_user
-- (mig 0077) invoca la edge function alta-cliente-portal que crea el user
-- real + vincula + encola email con credenciales reales.

-- [Cuerpo de la migración omitido aquí — ya está aplicado en DB.
--  Ver el RPC final con \df+ public.solicitud_derivar / solicitud_activar.]
SELECT 'mig 0076 aplicada via apply_migration el 2026-05-26' AS info;
