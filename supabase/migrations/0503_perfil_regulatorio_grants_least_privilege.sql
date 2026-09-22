-- 0503 · Agenda Fase 1 · hardening de grants de `perfil_regulatorio` (least-privilege, R6).
-- Hallazgo del §6 (Agent B, seguridad) sobre el writer:
--  L1 (media, latente): la tabla arrastraba el GRANT DEFAULT de Supabase a `anon`
--     (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES). Hoy inofensivo porque
--     ninguna policy apunta a `anon` (RLS deniega por default), pero es una bomba latente:
--     una futura policy `TO anon`/`TO public` habilitaría acceso total cross-tenant. El flujo
--     NO tiene camino público → se revoca TODO a anon (R6: "anon sólo si el flujo lo necesita").
--  L2/L3 (baja): `authenticated` conservaba DELETE/TRUNCATE/TRIGGER/REFERENCES (0502 sólo revocó
--     INSERT/UPDATE). El invariante del módulo es "todo write pasa por la RPC definer" → se deja
--     a `authenticated` SÓLO SELECT. El staff sigue leyendo por policy FOR ALL; declarar corre
--     como owner y no necesita grants de tabla. Ningún flujo vivo se rompe (tabla nueva, read-only
--     desde el front + write por RPC).
-- Verificado e2e por el §6: cliente no lee filas ajenas (RLS sólida); anon sin acceso; declarar OK.

REVOKE ALL ON public.perfil_regulatorio FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.perfil_regulatorio FROM authenticated;
GRANT SELECT ON public.perfil_regulatorio TO authenticated;  -- idempotente: read para gerencia/cliente por RLS
