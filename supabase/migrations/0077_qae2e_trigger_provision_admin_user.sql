-- 0077 · EGG-QA-10 · trigger AFTER INSERT en administraciones que invoca
-- alta-cliente-portal edge fn vía pg_net.
-- (aplicada el 2026-05-26 via apply_migration)
--
-- Cuando se crea una administración con email pero sin user_id (escenario
-- "cliente nuevo desde wizard"), este trigger dispara una llamada async a
-- la edge function alta-cliente-portal que:
--   1. Crea el user en auth.users via admin API
--   2. Genera password temporal seguro (16 chars, sin caracteres ambiguos)
--   3. Vincula administracion.user_id ← user.id
--   4. Asegura profile.role='administrador'
--   5. Encola email 'bienvenida-administracion' con {{password_temporal}}
--
-- Auth: usa current_setting('app.service_role_key', true). Requiere que el
-- DBA haya seteado ALTER DATABASE ... SET app.service_role_key = '...'
-- (mismo approach que dispatch-emails-1min cron).

SELECT 'mig 0077 aplicada via apply_migration el 2026-05-26 · ver código vía \\df+ private.trg_provision_admin_user_portal' AS info;
