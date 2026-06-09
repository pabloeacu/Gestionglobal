-- 0214_webinars_rls_secretos_staff_only.sql
-- E-GG-62 · Fuga de secretos Zoom/Webex en public.webinars (regla 3)
--
-- Capitalizado en la auditoría §6 de F6 (webinars), 2026-06-09. La policy
-- `webinars_authenticated_select` (creada en mig 0050) usaba `USING (true)`:
-- CUALQUIER usuario `authenticated` —incluido un `administrador` cliente del
-- portal— podía `supabase.from('webinars').select('*')` y leer columnas
-- SECRETAS: zoom_join_url, zoom_start_url (¡URL de HOST: inicia/controla la
-- reunión!), zoom_password, zoom_meeting_id, zoom_meeting_number,
-- webex_join_url, webex_password. Viola la regla 3 (sin secretos en el front).
-- Es deuda heredada de 0050, NO una regresión de F6.
--
-- NINGÚN flujo real lo necesita (verificado en la auditoría):
--   · Cliente logueado  → ve sus webinars por la RPC `cliente_webinars_listar`
--     (SECURITY DEFINER, curada; entrega el link de join sólo a inscriptos).
--   · Prospecto / anon   → identidad pública por la RPC `webinar_inscripcion_activa`
--     (SD, sin secretos) + acceso por la edge fn `webinar-acceso` (service-role;
--     la llave es el token de inscripción, no la RLS).
--   · Gerencia           → `webinars_staff_all` (FOR ALL, USING private.is_staff()).
-- El único read directo del front alcanzable por no-staff
-- (`resolverEsquemaParaCert`, src/services/api/campus.ts) está neutralizado:
-- la emisión de cert de webinar (mig 0088) persiste `esquema_snapshot`, así que
-- el front retorna antes de tocar la tabla (y si no hubiese snapshot, cae al
-- esquema default — nunca rompe).
--
-- Fix (opción (a), decidida con Pablo 2026-06-09): la tabla se lee SÓLO por
-- gerencia. `webinars_staff_all` (FOR ALL → su USING gobierna también el SELECT)
-- ya es la autoridad sólo-gerencia; por eso ELIMINAMOS la policy permisiva en
-- lugar de reescribirla a is_staff() (que dejaría dos policies SELECT
-- redundantes y confusas para auditorías futuras).
--
-- El smoke R18 (cliente NO lee zoom_password / gerencia SÍ) se corre FUERA de la
-- migración, en su propia transacción BEGIN/ROLLBACK con impersonación de rol,
-- para no dejar datos sintéticos ni arriesgar la propia migración (lección
-- E-GG-54: DO+RAISE NOTICE no rollbackea bajo el runner de migraciones).

BEGIN;

DROP POLICY IF EXISTS webinars_authenticated_select ON public.webinars;

COMMENT ON POLICY webinars_staff_all ON public.webinars IS
  'Única autoridad de acceso a webinars: SÓLO gerencia (private.is_staff()). Clientes/prospectos NUNCA leen esta tabla directo: traen datos curados por las RPCs cliente_webinars_listar / webinar_inscripcion_activa y la edge fn webinar-acceso. Cerrado E-GG-62 (regla 3): la vieja webinars_authenticated_select USING(true) filtraba secretos Zoom/Webex (zoom_start_url de host, passwords) a cualquier authenticated.';

COMMIT;
