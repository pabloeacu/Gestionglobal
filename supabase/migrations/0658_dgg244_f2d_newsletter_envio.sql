-- 0658 · DGG-244 F2d-B · Envío del newsletter (teaser → web) a los suscriptores confirmados.
--
-- Pablo eligió formato "teaser → a la web": email corto de marca (intro de la edición +
-- nota de tapa) con CTA "Leer la edición completa" → /lexph. NO toca el edge money-crítico
-- `dispatch-emails` (gate R7): reusa la cola template-based con variables de TEXTO (que el
-- edge escapa — correcto para texto plano) + la URL por renderVarsRaw en cta_url.
--
-- Acción de staff (NO auto al cerrar): botón "Enviar newsletter" en el CMS de edición, para
-- que Pablo mande cuando quiera. Respeta `email_suppression` (compliance) y baja por token.

-- ============================================================================
-- 1. Control de envío por edición
-- ============================================================================
ALTER TABLE public.lexph_ediciones
  ADD COLUMN IF NOT EXISTS newsletter_enviado_at timestamptz;
COMMENT ON COLUMN public.lexph_ediciones.newsletter_enviado_at IS
  'DGG-244 F2d · Cuándo se envió el newsletter de esta edición (para avisar re-envío en la UI).';

-- ============================================================================
-- 2. Plantilla del newsletter (teaser) — manaxer-v1, net-new, idempotente
-- ============================================================================
INSERT INTO public.email_templates
  (slug, nombre, asunto, from_casilla, reply_to, activo, layout_version, color_acento, mostrar_logo,
   kicker, titulo_visual, cuerpo_html_visual, cta_text, cta_url, body_html, body_text, descripcion)
VALUES
  ('lexph-newsletter', 'LexPH · Newsletter (teaser)',
   'Novedades de propiedad horizontal · LexPH', 'general', NULL, true, 'manaxer-v1', '#009ECA', true,
   'LexPH · Un servicio de Gestión Global',
   'Nueva edición de LexPH',
   '<p style="margin:0 0 14px;">{{intro}}</p>'
   '<p style="margin:0 0 14px;">{{destacada}}</p>'
   '<p style="margin:0 0 14px;">Leé el análisis completo —resumen ejecutivo, tendencias por materia e insight— en la web.</p>'
   '<p style="margin:26px 0 0;font-size:12px;color:#94a3b8;">Recibís esto porque te suscribiste a LexPH. <a href="{{baja_url}}" style="color:#94a3b8;">Darme de baja</a>.</p>',
   'Leer la edición completa', '{{url}}',
   '<!doctype html><html lang="es"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#122230;padding:24px;"><p>{{intro}}</p><p>{{destacada}}</p><p><a href="{{url}}" style="color:#009ECA;">Leer la edición completa en LexPH</a></p><p style="font-size:12px;color:#8aa;">Recibís esto porque te suscribiste a LexPH. <a href="{{baja_url}}">Darme de baja</a>.</p></body></html>',
   'LexPH — novedades de propiedad horizontal. {{intro}} Leé la edición completa: {{url}} · Baja: {{baja_url}}',
   'DGG-244 F2d · newsletter teaser de LexPH (empuja a la web).')
ON CONFLICT (slug) DO UPDATE SET
   asunto = EXCLUDED.asunto, from_casilla = EXCLUDED.from_casilla, activo = EXCLUDED.activo,
   layout_version = EXCLUDED.layout_version, color_acento = EXCLUDED.color_acento,
   mostrar_logo = EXCLUDED.mostrar_logo, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
   cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text, cta_url = EXCLUDED.cta_url,
   body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, updated_at = now();

-- ============================================================================
-- 3. RPC de envío (staff) — encola el teaser a cada confirmado NO suprimido
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_newsletter_enviar(p_edicion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_intro     text;
  v_destacada text;
  v_already   timestamptz;
  v_count     int := 0;
BEGIN
  IF NOT (SELECT private.is_staff()) THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede enviar el newsletter.' USING ERRCODE = '42501';
  END IF;

  SELECT e.intro, e.newsletter_enviado_at,
         (SELECT a.titulo FROM public.lexph_articulos a
           WHERE a.id = e.destacado_articulo_id AND a.estado = 'publicado')
    INTO v_intro, v_already, v_destacada
  FROM public.lexph_ediciones e WHERE e.id = p_edicion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Edición no encontrada (id=%).', p_edicion_id USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(btrim(v_intro), '') = '' THEN
    RAISE EXCEPTION 'Completá al menos la intro del digest antes de enviar el newsletter.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  SELECT
    'workflow', 'lexph-newsletter', s.email,
    jsonb_build_object(
      'intro', v_intro,
      'destacada', CASE WHEN v_destacada IS NOT NULL
                        THEN 'Nota de tapa: ' || v_destacada
                        ELSE 'Fallos, normativas e insights de propiedad horizontal.' END,
      'url', 'https://www.gestionglobal.ar/lexph',
      'baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
    5, 'lexph_suscriptores', s.id, now()
  FROM public.lexph_suscriptores s
  WHERE s.estado = 'confirmado'
    AND NOT EXISTS (
      SELECT 1 FROM public.email_suppression sup
      WHERE lower(btrim(sup.email)) = s.email_norm
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.lexph_ediciones SET newsletter_enviado_at = now() WHERE id = p_edicion_id;

  RETURN jsonb_build_object('ok', true, 'enviados', v_count, 'reenvio', v_already IS NOT NULL);
END;
$$;
COMMENT ON FUNCTION public.lexph_newsletter_enviar IS
  'DGG-244 F2d · Encola el newsletter teaser de una edición a los suscriptores confirmados (skip suprimidos). Staff-only.';
REVOKE ALL ON FUNCTION public.lexph_newsletter_enviar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_newsletter_enviar(uuid) TO authenticated;
