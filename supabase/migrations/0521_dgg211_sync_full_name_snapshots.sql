-- 0521_dgg211_sync_full_name_snapshots.sql
-- DGG-211 / E-GG-223 — Al editar `profiles.full_name` el cambio NO se propagaba
-- a los snapshots "vivos" de autoría del timeline de trámites:
--   · tramite_comentarios.autor_nombre (copiado del perfil al comentar)
--   · tramite_eventos.actor_nombre    (copiado del perfil al ocurrir el evento)
-- → si una persona con historial se renombraba, su historial quedaba con el
-- nombre viejo ("impactó en algunos lados y en otros no"). Es el MISMO patrón ya
-- corregido para el email (E-GG-195 / mig 0456, trg_sync_tramite_email_admin),
-- que nunca se replicó para el nombre.
--
-- NO se tocan (a propósito):
--   · administraciones.nombre/responsable_nombre → el nombre de la EMPRESA/cliente,
--     campo independiente del perfil personal (se edita en la ficha, en gerencia).
--   · certificados / email_queue / formulario_submissions → snapshots históricos
--     INTENCIONALES (congelados al emitir/enviar/tipear).
--   · tramites.solicitante_nombre → el solicitante es la empresa/el form, no el
--     perfil (la grilla ya usa administracion_nombre vivo).
--   · auth.users metadata → dormido (la app lee profiles.full_name, no el JWT).
--
-- R17: tramite_eventos tiene RLS habilitada SIN policy de write (log) → el trigger
-- DEBE ser SECURITY DEFINER o el UPDATE del invoker se bloquea con 42501.

CREATE OR REPLACE FUNCTION private.profiles_sync_full_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Autoría de comentarios del timeline.
  UPDATE public.tramite_comentarios
     SET autor_nombre = NEW.full_name
   WHERE autor_id = NEW.id
     AND autor_nombre IS DISTINCT FROM NEW.full_name;

  -- Autoría de eventos del timeline.
  UPDATE public.tramite_eventos
     SET actor_nombre = NEW.full_name
   WHERE actor_id = NEW.id
     AND actor_nombre IS DISTINCT FROM NEW.full_name;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_sync_full_name ON public.profiles;
CREATE TRIGGER trg_profiles_sync_full_name
AFTER UPDATE OF full_name ON public.profiles
FOR EACH ROW
WHEN (NEW.full_name IS DISTINCT FROM OLD.full_name)
EXECUTE FUNCTION private.profiles_sync_full_name();

-- ============================================================================
-- Backfill: alinear los snapshots existentes con el nombre actual del perfil.
-- (Hoy ~0 filas desalineadas; se ejecuta por correctitud e idempotencia.)
-- ============================================================================
UPDATE public.tramite_comentarios c
   SET autor_nombre = p.full_name
  FROM public.profiles p
 WHERE p.id = c.autor_id
   AND c.autor_nombre IS DISTINCT FROM p.full_name;

UPDATE public.tramite_eventos e
   SET actor_nombre = p.full_name
  FROM public.profiles p
 WHERE p.id = e.actor_id
   AND e.actor_nombre IS DISTINCT FROM p.full_name;
