-- 0491 · Fase A · corrige 0490: el grant de EXECUTE a las funciones de trigger venía por PUBLIC (default
-- Supabase), y REVOKE ... FROM anon,authenticated NO remueve el grant de PUBLIC (anon/auth lo heredan). Se
-- revoca de PUBLIC también, sobre TODAS las funciones de trigger de public (secdef y no-secdef, 59 en total).
-- Seguro: las triggers disparan por el mecanismo de triggers (contexto del owner de la tabla), NO por el
-- EXECUTE del rol que hace el statement → REVOKE es inocuo para el disparo (verificado empíricamente en §6).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.prorettype='pg_catalog.trigger'::regtype
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION '||r.sig||' FROM PUBLIC, anon, authenticated';
  END LOOP;
END $$;
