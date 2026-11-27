-- 0756 · E-GG-322 (root fix) — provisión de portal del cliente: segura + con certeza
-- =============================================================================
-- Contexto: el trigger `trg_admin_provision_user` (AFTER INSERT en
-- administraciones) dependía de `current_setting('app.service_role_key')` —
-- una GUC que NO está seteada en prod (loguea "app.service_role_key no
-- configurado" y hace no-op). Era código MUERTO + una trampa de seguridad:
-- "revivirlo" seteando esa GUC dejaría la service_role_key (que saltea RLS)
-- legible por cualquier sesión `authenticated`/`anon` = compromiso total.
--
-- Realidad verificada: los 4 caminos de alta de admin del front YA provisionan
-- explícitamente vía el edge idempotente `alta-cliente-portal`
-- (solicitud_activar/ProcesadorFinal, WizardDdjjExterna, AdministracionFormDrawer,
-- y el botón "Crear acceso al portal" de la ficha). En prod hay 0 admins activos
-- con email y sin usuario de portal → la provisión explícita funciona al 100%.
--
-- Fix:
--  (1) Retirar el trigger muerto + su función (seguridad + no-trampa).
--  (2) Backstop de CERTEZA: un reconciliador que, ante una falla transitoria
--      del front, re-invoca el edge idempotente para admins recientes con
--      email, con un trámite (= intención operativa real; excluye importaciones
--      masivas sin trámites) y sin usuario. Usa `private.cron_bearer()` (token
--      desde Vault, NO la service key suelta) — el mismo patrón de todos los
--      crons que llaman edges. Kill-switch por si entra una carga masiva.
-- =============================================================================

-- (1) Retirar el trigger muerto + su función.
DROP TRIGGER IF EXISTS trg_admin_provision_user ON public.administraciones;
DROP FUNCTION IF EXISTS private.trg_provision_admin_user_portal();

-- (2a) Kill-switch (pausar la reconciliación ante una importación masiva).
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS portal_provision_reconciliar_on boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.config_global.portal_provision_reconciliar_on IS
  'E-GG-322: si OFF, el cron portal-provision-reconciliar no re-provisiona. Apagar antes de una importación masiva de admins con email que NO deban recibir bienvenida.';

-- (2b) Reconciliador: re-invoca alta-cliente-portal (idempotente) para admins
--      recientes, con email, con trámite y sin usuario de portal.
CREATE OR REPLACE FUNCTION private.portal_provision_reconciliar(p_limit int DEFAULT 25)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  n int := 0;
  v_on boolean;
BEGIN
  SELECT portal_provision_reconciliar_on INTO v_on FROM public.config_global WHERE id = 1;
  IF NOT COALESCE(v_on, false) THEN RETURN 0; END IF;

  FOR r IN
    SELECT a.id, a.email, a.nombre
      FROM public.administraciones a
     WHERE a.activo
       AND a.user_id IS NULL
       AND a.email IS NOT NULL AND btrim(a.email) <> ''
       AND a.created_at > now() - interval '14 days'
       AND EXISTS (SELECT 1 FROM public.tramites t WHERE t.administracion_id = a.id)
     ORDER BY a.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/alta-cliente-portal',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', private.cron_bearer()),
        body    := jsonb_build_object('administracion_id', r.id::text,
                                      'email', r.email, 'nombre', r.nombre),
        timeout_milliseconds := 20000);
      n := n + 1;
      RAISE LOG 'portal_provision_reconciliar: reintenté provisión de portal para admin %', r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'portal_provision_reconciliar: fallo POST admin %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION private.portal_provision_reconciliar(int) FROM PUBLIC;

-- (2c) Cron cada 10 min (upsert por nombre).
SELECT cron.schedule('portal-provision-reconciliar', '*/10 * * * *',
  $$SELECT private.portal_provision_reconciliar(25);$$);
