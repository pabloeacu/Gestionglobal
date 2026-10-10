-- 0538_dgg218_fase2b_reverify_revoke_dml.sql
-- DGG-218 F2B · §6 M1 (defensivo): la cola de re-verificación hereda los grants
-- default de Supabase (anon/authenticated con DML). RLS ya lo neutraliza (sin
-- policy de write + no-staff ni siquiera SELECTea), pero se revoca explícito
-- (belt-and-suspenders): la cola la administra sólo el service_role (edge/cron).
REVOKE INSERT, UPDATE, DELETE ON public.tramix_reverify_queue FROM anon, authenticated;
