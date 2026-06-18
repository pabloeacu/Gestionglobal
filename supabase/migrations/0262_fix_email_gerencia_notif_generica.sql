-- ============================================================================
-- 0262_fix_email_gerencia_notif_generica.sql
-- DGG-89 §6 (sweep) · La plantilla de alto tráfico gerencia-notif-generica (avisos
-- internos a gerencia: cierre/reapertura de trámites, fan-out, moderación, trámite
-- resuelto…) arrastra el MISMO bug que solicitud-docs-revision: layout 'manaxer-v1'
-- con titulo_visual/kicker/cuerpo_html_visual vacíos → el dispatcher manda mail vacío
-- (sólo logo + asunto), ignorando el body_html viejo. Fix de DATOS: poblar los campos
-- visuales replicando el body_html ({{titulo_evento}}/{{cuerpo}}/{{url}}).
-- (Pendiente recomendado aparte: fallback en buildManaxerHtml a body_html cuando
--  cuerpo_html_visual queda vacío, para blindar contra ediciones futuras del editor.)
-- ============================================================================
UPDATE public.email_templates
   SET kicker        = 'Notificación interna',
       titulo_visual = '{{titulo_evento}}',
       cuerpo_html_visual = '<p style="margin:0;white-space:pre-wrap;color:#1e293b;">{{cuerpo}}</p>',
       cta_text      = COALESCE(NULLIF(cta_text,''), 'Ver en la plataforma'),
       cta_url       = COALESCE(NULLIF(cta_url,''), 'https://www.gestionglobal.ar{{url}}')
 WHERE slug = 'gerencia-notif-generica';
