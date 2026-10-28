-- 0600_dgg232_engagement_onboarding.sql
-- DGG-232 · Onboarding de engagement (app + notificaciones)
-- --------------------------------------------------------------------------
-- Idea de Pablo: cada ~60 días, barrer TODOS los clientes y, según su estado
-- de instalación de la PWA + suscripción push, mandarles un mail estimulante
-- que les muestre todo el valor de llevar la plataforma en el teléfono y
-- recibir los avisos. 3 buckets → 3 mails premium (banner + bullets de valor
-- + guía PDF hosteada), encolados por el pipeline templated (manaxer-v1).
--
--   bucket 'ambas'    (sin PWA  + sin push)  → engagement-instalar-activar
--   bucket 'instalar' (sin PWA  + con push)  → engagement-instalar
--   bucket 'activar'  (con PWA  + sin push)  → engagement-activar
--   (con PWA + con push → NO se toca)
--
-- Destinos de los botones (Pablo preguntó dónde llevan):
--   · notificaciones se activan en /portal/perfil (botón "Activar").
--   · la instalación la ofrece el banner global PortalPwaAssistant al abrir
--     /portal (no es ruteable: es un prompt del browser / manual en iOS).
--   Por eso cada mail trae además una GUÍA PDF con el paso a paso + capturas
--   + advertencias iOS/Android (link hosteado, no adjunto — ver nota abajo).
--
-- GATING (regla DGG-199 / precedente DGG-220): arranca con el flag OFF. El
-- cron queda agendado pero la función se auto-gatea: no encola NADA hasta que
-- config_global.engagement_onboarding_activo = true. Un solo flag = go/no-go.
--
-- Nota adjunto-vs-link: el pipeline templated (dispatch-emails) NO soporta
-- adjuntos (sólo los edges MIME dedicados). Se eligió LINK al PDF hosteado por
-- (a) entregabilidad (un adjunto en envío masivo golpea reputación — prioridad
-- DGG-223) y (b) reusar el pipeline probado. Si se quisiera adjunto real, es un
-- edge MIME aparte (como send-certificado-email). Decisión a confirmar con Pablo.
-- --------------------------------------------------------------------------

-- 1) Flag de activación (singleton config_global) -------------------------
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS engagement_onboarding_activo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.config_global.engagement_onboarding_activo IS
  'DGG-232: go/no-go del barrido de engagement (app+push). OFF por default; '
  'gg_engagement_barrido() no encola nada mientras esté en false.';

-- 2) Log del barrido (server-only, mismo patrón que ofrecimientos_log) -----
CREATE TABLE IF NOT EXISTS public.engagement_onboarding_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  bucket            text NOT NULL CHECK (bucket IN ('ambas','instalar','activar')),
  template_slug     text NOT NULL,
  resultado         text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','skipped','error')),
  detalle           text,
  enviado_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.engagement_onboarding_log ENABLE ROW LEVEL SECURITY;
-- Server-only: escribe gg_engagement_barrido() (SECURITY DEFINER, R17). Sin
-- policies ni grant a authenticated — gerencia lee vía RPC SECDEF si hace falta.
-- (R6 post-0130: NO se otorga a authenticated a propósito; es tabla de backend.)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_onboarding_log TO service_role;
CREATE INDEX IF NOT EXISTS engagement_onboarding_log_admin_at_idx
  ON public.engagement_onboarding_log (administracion_id, enviado_at DESC);
COMMENT ON TABLE public.engagement_onboarding_log IS
  'DGG-232: rastro del barrido de engagement. Dedup 60 días por administracion. '
  'Tabla de backend: escrita por SECDEF, sin acceso de authenticated.';

-- 3) Plantillas de email (3 buckets) --------------------------------------
--    Estructura calcada de ofrecimiento-perfil-incompleto (banner-hero
--    manaxer-v1): banner <img width=576> → saludo → intro → bullets de valor
--    (la frase diaria va en las 3) → botón secundario "guía PDF" → el layout
--    agrega el CTA principal (cta_text/cta_url).

-- 3a) AMBAS: sin app + sin notificaciones
INSERT INTO public.email_templates
  (slug, nombre, asunto, kicker, titulo_visual, color_acento, body_html, cuerpo_html_visual,
   cta_text, cta_url, from_casilla, variables, layout_version, mostrar_logo, activo)
VALUES (
  'engagement-instalar-activar',
  'Engagement · Instalá la app y activá los avisos (ambas)',
  'Llevá Gestión Global en tu teléfono y que no se te pase nada',
  '', '', '#009ECA', '<!-- manaxer-v1 -->',
  $html$<img src="https://www.gestionglobal.ar/email/engagement-ambas.png" alt="Que no se te pase nada · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 16px;">Tu plataforma de Gestión Global ya está lista — pero todavía no la llevás en el bolsillo ni te llegan nuestros avisos. Con <strong>dos pasos muy simples</strong> la sumás a la pantalla de tu teléfono y activás las notificaciones. Desde ahí, lo importante te busca a vos.</p><p style="margin:0 0 10px;font-family:Oswald,Arial,sans-serif;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:#0B1F33;font-weight:600;">Todo esto te espera adentro</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;Frases diarias que <strong>estimulan tu gestión y tu liderazgo</strong></td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Comunicados y novedades del RPAC</strong>, apenas salen</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Alertas de tus vencimientos profesionales</strong>, siempre a tiempo</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Webinars y capacitaciones</strong> (muchas, sin costo)</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;El <strong>estado de tus gestiones</strong>, en tiempo real</td></tr></table><p style="margin:0 0 10px;font-size:14px;color:#5D7284;">¿Querés el paso a paso con capturas, para iPhone y Android?</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;"><tr><td style="border:1.5px solid #009ECA;border-radius:8px;background:#E7F1F9;"><a href="https://www.gestionglobal.ar/email/guia-completa.pdf" style="display:inline-block;padding:11px 22px;font-family:Oswald,Arial,sans-serif;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#0B1F33;text-decoration:none;font-weight:600;">Descargá la guía (2 pasos · PDF)</a></td></tr></table>$html$,
  'Abrir mi portal',
  'https://gestionglobal.ar/portal/perfil?origen=engagement',
  'general', '["nombre"]'::jsonb, 'manaxer-v1', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, asunto=EXCLUDED.asunto, kicker=EXCLUDED.kicker,
  titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  body_html=EXCLUDED.body_html, cuerpo_html_visual=EXCLUDED.cuerpo_html_visual,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, from_casilla=EXCLUDED.from_casilla,
  variables=EXCLUDED.variables, layout_version=EXCLUDED.layout_version,
  mostrar_logo=EXCLUDED.mostrar_logo, activo=EXCLUDED.activo;

-- 3b) INSTALAR: con notificaciones, sin app
INSERT INTO public.email_templates
  (slug, nombre, asunto, kicker, titulo_visual, color_acento, body_html, cuerpo_html_visual,
   cta_text, cta_url, from_casilla, variables, layout_version, mostrar_logo, activo)
VALUES (
  'engagement-instalar',
  'Engagement · Sumá la app a tu pantalla (instalar)',
  'Sumá la app de Gestión Global a tu pantalla de inicio',
  '', '', '#009ECA', '<!-- manaxer-v1 -->',
  $html$<img src="https://www.gestionglobal.ar/email/engagement-instalar.png" alt="Sumá la app a tu pantalla · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 16px;">Ya recibís nuestras notificaciones — ahora sumá la app a la <strong>pantalla de inicio</strong> de tu teléfono. Entrás de un solo toque, sin buscar el navegador, como una app más: rápida, a mano y siempre lista.</p><p style="margin:0 0 10px;font-family:Oswald,Arial,sans-serif;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:#0B1F33;font-weight:600;">Lo que vas a tener de un toque</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;Frases diarias que <strong>estimulan tu gestión y tu liderazgo</strong></td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Comunicados y novedades del RPAC</strong>, apenas salen</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Alertas de tus vencimientos profesionales</strong>, siempre a tiempo</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Webinars y capacitaciones</strong> (muchas, sin costo)</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;El <strong>estado de tus gestiones</strong>, en tiempo real</td></tr></table><p style="margin:0 0 10px;font-size:14px;color:#5D7284;">¿Querés el paso a paso con capturas? En iPhone se instala desde Safari; en Android, desde Chrome.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;"><tr><td style="border:1.5px solid #009ECA;border-radius:8px;background:#E7F1F9;"><a href="https://www.gestionglobal.ar/email/guia-instalacion.pdf" style="display:inline-block;padding:11px 22px;font-family:Oswald,Arial,sans-serif;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#0B1F33;text-decoration:none;font-weight:600;">Descargá la guía de instalación (PDF)</a></td></tr></table>$html$,
  'Abrir e instalar la app',
  'https://gestionglobal.ar/portal?origen=engagement',
  'general', '["nombre"]'::jsonb, 'manaxer-v1', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, asunto=EXCLUDED.asunto, kicker=EXCLUDED.kicker,
  titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  body_html=EXCLUDED.body_html, cuerpo_html_visual=EXCLUDED.cuerpo_html_visual,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, from_casilla=EXCLUDED.from_casilla,
  variables=EXCLUDED.variables, layout_version=EXCLUDED.layout_version,
  mostrar_logo=EXCLUDED.mostrar_logo, activo=EXCLUDED.activo;

-- 3c) ACTIVAR: con app, sin notificaciones
INSERT INTO public.email_templates
  (slug, nombre, asunto, kicker, titulo_visual, color_acento, body_html, cuerpo_html_visual,
   cta_text, cta_url, from_casilla, variables, layout_version, mostrar_logo, activo)
VALUES (
  'engagement-activar',
  'Engagement · Activá tus avisos (activar)',
  'Activá tus avisos y no dependas de la memoria · Gestión Global',
  '', '', '#009ECA', '<!-- manaxer-v1 -->',
  $html$<img src="https://www.gestionglobal.ar/email/engagement-activar.png" alt="Activá tus avisos · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 16px;">Ya tenés la app instalada en tu teléfono — ahora <strong>activá las notificaciones</strong> para no depender de abrirla. Nosotros te avisamos cuando algo importa: un vencimiento que se acerca, una gestión resuelta, un comunicado del RPAC.</p><p style="margin:0 0 10px;font-family:Oswald,Arial,sans-serif;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:#0B1F33;font-weight:600;">Lo que vas a recibir</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;Frases diarias que <strong>estimulan tu gestión y tu liderazgo</strong></td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Comunicados y novedades del RPAC</strong>, apenas salen</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Alertas de tus vencimientos profesionales</strong>, siempre a tiempo</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;<strong>Webinars y capacitaciones</strong> (muchas, sin costo)</td></tr><tr><td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#122230;"><span style="color:#009ECA;font-weight:700;">&#9656;</span>&nbsp;&nbsp;El <strong>estado de tus gestiones</strong>, en tiempo real</td></tr></table><p style="margin:0 0 10px;font-size:14px;color:#5D7284;">En iPhone recordá que las notificaciones se activan con la app ya instalada. ¿Querés el paso a paso con capturas?</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;"><tr><td style="border:1.5px solid #009ECA;border-radius:8px;background:#E7F1F9;"><a href="https://www.gestionglobal.ar/email/guia-notificaciones.pdf" style="display:inline-block;padding:11px 22px;font-family:Oswald,Arial,sans-serif;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#0B1F33;text-decoration:none;font-weight:600;">Descargá la guía de notificaciones (PDF)</a></td></tr></table>$html$,
  'Activar notificaciones',
  'https://gestionglobal.ar/portal/perfil?origen=engagement',
  'general', '["nombre"]'::jsonb, 'manaxer-v1', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, asunto=EXCLUDED.asunto, kicker=EXCLUDED.kicker,
  titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  body_html=EXCLUDED.body_html, cuerpo_html_visual=EXCLUDED.cuerpo_html_visual,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, from_casilla=EXCLUDED.from_casilla,
  variables=EXCLUDED.variables, layout_version=EXCLUDED.layout_version,
  mostrar_logo=EXCLUDED.mostrar_logo, activo=EXCLUDED.activo;

-- 4) Motor de detección + envío -------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_engagement_barrido()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_activo      boolean;
  v_hoy         date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cap         int  := 40;   -- tope por corrida (warm-up + reputación, DGG-223)
  v_cooldown    int  := 60;   -- días entre toques por cliente (idea de Pablo)
  v_enviados    int  := 0;
  v_rec         record;
  v_bucket      text;
  v_tpl         text;
  v_asunto      text;
  v_ambas int := 0; v_instalar int := 0; v_activar int := 0; v_sup int := 0;
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
      SELECT max(l.enviado_at) AS ult
      FROM public.engagement_onboarding_log l
      WHERE l.administracion_id = a.id AND l.resultado = 'ok'
    ) le ON true
    WHERE a.activo AND a.estado <> 'baja'
      AND a.ofrecimientos_habilitados           -- respeta opt-out de comms (hoy 176/176 on)
      AND a.user_id IS NOT NULL
      AND a.email IS NOT NULL AND trim(a.email) <> ''
      -- excluir quienes YA tienen app + notificaciones
      AND NOT (p.pwa_installed_at IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = a.user_id))
      -- dedup por cooldown
      AND (le.ult IS NULL OR le.ult < now() - make_interval(days => v_cooldown))
    ORDER BY le.ult ASC NULLS FIRST, a.created_at ASC
  LOOP
    EXIT WHEN v_enviados >= v_cap;

    IF NOT v_rec.pwa AND NOT v_rec.push THEN
      v_bucket := 'ambas';    v_tpl := 'engagement-instalar-activar';
    ELSIF v_rec.push AND NOT v_rec.pwa THEN
      v_bucket := 'instalar'; v_tpl := 'engagement-instalar';
    ELSE  -- pwa AND NOT push
      v_bucket := 'activar';  v_tpl := 'engagement-activar';
    END IF;

    -- Supresión global (DGG-224): baja/opt-out/rebote → no se encola.
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
       v_asunto, '{}', 1, 1);

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
    'suprimidos_skip',v_sup);
END;
$fn$;

COMMENT ON FUNCTION public.gg_engagement_barrido() IS
  'DGG-232: barre clientes y encola el mail de engagement según bucket '
  '(app/push). Auto-gateado por config_global.engagement_onboarding_activo. '
  'Cap 40/corrida, dedup 60 días, respeta supresión (DGG-224). SECDEF por R17.';

-- Server-only: sólo cron/service. (B1 DGG-231: no exponer a authenticated.)
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM public;
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM authenticated;
REVOKE ALL ON FUNCTION public.gg_engagement_barrido() FROM anon;
GRANT EXECUTE ON FUNCTION public.gg_engagement_barrido() TO service_role;

-- 5) Cron semanal (INERTE mientras el flag esté OFF) ----------------------
--    Lunes 13:05 UTC = 10:05 ART. La función se auto-gatea: NO manda nada
--    hasta prender engagement_onboarding_activo. Un flag = go-live.
DO $cron$
BEGIN
  PERFORM cron.unschedule('gg-engagement-barrido');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;
SELECT cron.schedule('gg-engagement-barrido', '5 13 * * 1',
  $job$SELECT public.gg_engagement_barrido();$job$);
