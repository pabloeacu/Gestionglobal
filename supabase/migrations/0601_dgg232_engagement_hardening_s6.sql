-- 0601_dgg232_engagement_hardening_s6.sql
-- DGG-232 · Hardening capitalizado de la doble auditoría §6 sobre 0600.
-- Hallazgos (todos menores; nada bloqueaba, el feature está gateado OFF):
--   #2 (seguridad) · engagement_onboarding_log terminó con grants a anon/
--      authenticated por el default viejo de Supabase (el cambio es 30/10/2026,
--      2 días después). RLS default-deny ya protege, pero falta el REVOKE para
--      igualar el patrón server-only de ofrecimientos_log (defensa en profundidad).
--   #3 (correctness) · el cooldown anclaba sólo en resultado='ok', así que un
--      cliente suprimido/errorado nunca anclaba y se re-escaneaba + re-logueaba
--      en CADA corrida (log creciendo ~52 filas/año/suprimido). Ahora ancla en
--      cualquier resultado → descansa 60 días como todos.
--   #17 (observabilidad) · el jsonb de retorno omitía el conteo de 'error'.
--   #8 (prolijidad) · cast explícito '{}'::uuid[] en comprobante_ids.
--   #9 (UX) · el bucket 'ambas' aterrizaba en /portal/perfil, que NO monta
--      PortalPwaAssistant (el banner de instalación vive en PortalHome=/portal).
--      Se reapunta 'ambas' a /portal (instalar primero; en iOS el push recién
--      se activa con la app ya instalada). El PDF completo cubre los 2 pasos.
--   #11 (entregabilidad) · los 3 cta_url usaban el apex sin www (307→www, hop
--      extra + mezcla de hosts en el mismo mail). Se alinean a www.
--
-- NOTA go-live (NO en esta mig): la doble auditoría encontró que dispatch-emails
-- trata como "marketing" (List-Unsubscribe one-click + link de baja + re-check
-- soft de opt-out) sólo a slugs 'ofrecimiento-*'. Los 'engagement-*' hoy saldrían
-- sin header List-Unsubscribe ni link de baja. Para un barrido a ~167 clientes
-- (prioridad DGG-223 + reglas de bulk de Gmail/Yahoo) hay que extender ese
-- predicado a 'engagement-*' ANTES de prender el flag. Eso toca dispatch-emails
-- (edge money-critical, gate R7 de drift) → se hace con pull+diff previo, no a
-- ciegas, como paso del checklist de activación. Queda documentado, no omitido.

-- #2 · defensa en profundidad: quitar grants que el default viejo dejó puestos.
REVOKE ALL ON public.engagement_onboarding_log FROM anon, authenticated, PUBLIC;

-- #11 + #9 · alinear hosts a www y reapuntar 'ambas' a /portal.
UPDATE public.email_templates SET cta_url = 'https://www.gestionglobal.ar/portal?origen=engagement'
  WHERE slug IN ('engagement-instalar-activar','engagement-instalar');
UPDATE public.email_templates SET cta_url = 'https://www.gestionglobal.ar/portal/perfil?origen=engagement'
  WHERE slug = 'engagement-activar';

-- #3 + #17 + #8 · motor corregido.
CREATE OR REPLACE FUNCTION public.gg_engagement_barrido()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_activo      boolean;
  v_hoy         date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cap         int  := 40;
  v_cooldown    int  := 60;
  v_enviados    int  := 0;
  v_rec         record;
  v_bucket      text;
  v_tpl         text;
  v_asunto      text;
  v_ambas int := 0; v_instalar int := 0; v_activar int := 0; v_sup int := 0; v_err int := 0;
BEGIN
  SELECT engagement_onboarding_activo INTO v_activo FROM public.config_global LIMIT 1;
  IF COALESCE(v_activo, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('estado','deshabilitado','fecha',v_hoy);
  END IF;

  FOR v_rec IN
    SELECT a.id, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)),''), a.nombre) AS contacto,
           (p.pwa_installed_at IS NOT NULL) AS pwa,
           EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = a.user_id) AS push,
           le.ult AS ultimo_envio
    FROM public.administraciones a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN LATERAL (
      -- #3: ancla el cooldown en CUALQUIER resultado terminal (ok/skipped/error),
      -- así un suprimido no se re-escanea ni re-loguea cada corrida.
      SELECT max(l.enviado_at) AS ult
      FROM public.engagement_onboarding_log l
      WHERE l.administracion_id = a.id
    ) le ON true
    WHERE a.activo AND a.estado <> 'baja'
      AND a.ofrecimientos_habilitados
      AND a.user_id IS NOT NULL
      AND a.email IS NOT NULL AND trim(a.email) <> ''
      AND NOT (p.pwa_installed_at IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = a.user_id))
      AND (le.ult IS NULL OR le.ult < now() - make_interval(days => v_cooldown))
    ORDER BY le.ult ASC NULLS FIRST, a.created_at ASC
  LOOP
    EXIT WHEN v_enviados >= v_cap;

    IF NOT v_rec.pwa AND NOT v_rec.push THEN
      v_bucket := 'ambas';    v_tpl := 'engagement-instalar-activar';
    ELSIF v_rec.push AND NOT v_rec.pwa THEN
      v_bucket := 'instalar'; v_tpl := 'engagement-instalar';
    ELSE
      v_bucket := 'activar';  v_tpl := 'engagement-activar';
    END IF;

    IF public.email_esta_suprimido(v_rec.email) THEN
      INSERT INTO public.engagement_onboarding_log(administracion_id,bucket,template_slug,resultado,detalle)
      VALUES (v_rec.id, v_bucket, v_tpl, 'skipped', 'suprimido');
      v_sup := v_sup + 1;
      CONTINUE;
    END IF;

    SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_tpl AND activo;
    IF v_asunto IS NULL THEN
      INSERT INTO public.engagement_onboarding_log(administracion_id,bucket,template_slug,resultado,detalle)
      VALUES (v_rec.id, v_bucket, v_tpl, 'error', 'template_inexistente');
      v_err := v_err + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad,
       programado_para, scheduled_at, administracion_id, related_table, related_id,
       subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', v_tpl, trim(v_rec.email), v_rec.contacto,
       jsonb_build_object('nombre', v_rec.contacto), 7,
       now(), now(), v_rec.id, 'administraciones', v_rec.id,
       v_asunto, '{}'::uuid[], 1, 1);

    INSERT INTO public.engagement_onboarding_log(administracion_id,bucket,template_slug,resultado)
    VALUES (v_rec.id, v_bucket, v_tpl, 'ok');

    v_enviados := v_enviados + 1;
    IF    v_bucket = 'ambas'    THEN v_ambas    := v_ambas + 1;
    ELSIF v_bucket = 'instalar' THEN v_instalar := v_instalar + 1;
    ELSE                             v_activar  := v_activar + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'estado','ok', 'fecha',v_hoy, 'enviados',v_enviados, 'cap',v_cap,
    'cooldown_dias',v_cooldown,
    'ambas',v_ambas, 'instalar',v_instalar, 'activar',v_activar,
    'suprimidos_skip',v_sup, 'errores',v_err);
END;
$fn$;

-- CREATE OR REPLACE preserva ACL, pero reafirmamos el server-only (B1 DGG-231).
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM public;
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM authenticated;
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM anon;
GRANT EXECUTE ON FUNCTION public.gg_engagement_barrido() TO service_role;
