-- 0757 · E-GG-322 (fix del backstop de 0756) — DETECTAR + AVISAR, no auto-provisionar
-- =============================================================================
-- 0756 dejó el reconciliador llamando al edge `alta-cliente-portal` con
-- `cron_bearer()`. Ejercitándolo (§6) salió 401 "Sesión inválida": ese edge
-- exige server-side `Bearer = SERVICE_ROLE_KEY` (exacto) o un JWT de gerente —
-- NO acepta el `cron_secret`. Y es un edge de hardening crítico (anti-secuestro
-- C2): no conviene tocarle la auth ni redeployarlo por MCP a ciegas (drift R7).
--
-- Decisión (certeza + seguridad): el backstop NO auto-provisiona. DETECTA admins
-- que debieron provisionar y quedaron sin usuario de portal (email + trámite +
-- sin user, recientes) y AVISA a gerencia (campanita/push) UNA sola vez. Gerencia
-- resuelve con 1 clic en "Crear acceso al portal" (botón ya existente en la ficha,
-- que llama al edge con el JWT del gerente → auth válida). Seguro, idempotente,
-- sin redeploy de edge. Con 0 fallas históricas de provisión, esto es una red de
-- seguridad proactiva, no un fix de un problema activo.
-- =============================================================================

-- Marcador de idempotencia (un solo aviso por admin atascado).
ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS portal_provision_alertado_at timestamptz;

COMMENT ON COLUMN public.administraciones.portal_provision_alertado_at IS
  'E-GG-322: cuándo se avisó a gerencia que este admin quedó con trámite pero sin acceso al portal (backstop portal_provision_reconciliar). NULL = no avisado.';

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
    SELECT a.id, a.nombre, a.email
      FROM public.administraciones a
     WHERE a.activo
       AND a.user_id IS NULL
       AND a.email IS NOT NULL AND btrim(a.email) <> ''
       AND a.created_at > now() - interval '14 days'
       AND a.portal_provision_alertado_at IS NULL
       AND EXISTS (SELECT 1 FROM public.tramites t WHERE t.administracion_id = a.id)
     ORDER BY a.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
  LOOP
    BEGIN
      PERFORM public.notify_all_gerentes(
        'portal_sin_acceso',
        'Cliente sin acceso al portal',
        format('"%s" tiene un trámite abierto pero todavía no tiene acceso al portal. Entrá a su ficha y tocá "Crear acceso al portal".', r.nombre),
        '/gerencia/clientes/' || r.id::text,
        jsonb_build_object('administracion_id', r.id),
        false,                 -- p_send_email: sólo campanita/push, sin mail a gerentes
        NULL, NULL,
        4::smallint,
        'administraciones', r.id
      );
      UPDATE public.administraciones SET portal_provision_alertado_at = now() WHERE id = r.id;
      n := n + 1;
      RAISE LOG 'portal_provision_reconciliar: avisé a gerencia por admin sin portal %', r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'portal_provision_reconciliar: aviso admin % falló: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION private.portal_provision_reconciliar(int) FROM PUBLIC;

COMMENT ON COLUMN public.config_global.portal_provision_reconciliar_on IS
  'E-GG-322: si OFF, el cron portal-provision-reconciliar NO avisa a gerencia por admins sin portal. Apagar si entra una carga masiva de admins con email+trámite que no deban avisar.';
