-- ============================================================================
-- Migration: 0091_tracking_fixes_y_extras
-- Fecha: 2026-05-27
-- DGG-XX · 4 fixes detectados en QA visual del tracking:
--
--   1. Email tracking-avance-cliente llegaba VACÍO.
--      Causa: el template tenía layout_version='manaxer-v1' (default de la
--      columna) pero los campos visuales (kicker, titulo_visual,
--      cuerpo_html_visual, cta_text, cta_url) estaban NULL.
--      buildManaxerHtml() en el edge function ignora body_html cuando
--      layout_version='manaxer-v1' y arma el wrapper a partir de los campos
--      visuales → resultado solo logo + footer.
--      Fix: poblar los campos visuales con contenido + variables.
--
--   (Los items 2-4 son solo frontend y se commiten aparte.)
-- ============================================================================

UPDATE public.email_templates
SET
  kicker = 'Avance en tu trámite',
  titulo_visual = 'Hola {{destinatario_nombre}}',
  cuerpo_html_visual =
    '<p style="margin:0 0 12px 0;">Tenemos una novedad en tu gestión y queremos que estés al día.</p>'
    '<div style="background:#f0fdfa;border-left:4px solid #14b8a6;padding:14px 16px;margin:18px 0;border-radius:6px">'
      '<p style="margin:0 0 6px 0;font-size:13px;color:#0f766e;text-transform:uppercase;letter-spacing:0.5px"><strong>{{tipo}}</strong></p>'
      '<p style="margin:0;white-space:pre-wrap;color:#1f2937">{{descripcion}}</p>'
    '</div>'
    '<p style="margin:16px 0 0 0;">Toda la información completa (con archivos adjuntos si corresponde) está disponible en tu portal. Hacé click en el botón para verla.</p>',
  color_acento = '#0891b2',
  mostrar_logo = true,
  cta_text = 'Ver en mi portal',
  cta_url = '{{portal_url}}',
  firma = '— Equipo de Gestión Global',
  incluir_tabla_envio = false,
  layout_version = 'manaxer-v1',
  updated_at = now()
WHERE slug = 'tracking-avance-cliente';

-- Sanity: verificar que quedó bien
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.email_templates
  WHERE slug='tracking-avance-cliente'
    AND cuerpo_html_visual IS NOT NULL
    AND length(cuerpo_html_visual) > 100;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Template tracking-avance-cliente no quedó bien populado';
  END IF;
END;
$$;
