-- 0082 · Plantillas de email premium estilo MANAXER
--
-- Agrega campos visuales editables sobre `email_templates` para que cada
-- plantilla pueda ser "retocada" desde un editor visual (kicker + título +
-- color de acento + cuerpo rich-text + firma + CTA + toggle de logo y
-- tabla de metadatos del envío). El dispatcher arma el HTML final
-- envolviendo estos campos en el layout MANAXER (logo · kicker · h1 ·
-- cuerpo · firma · CTA · footer).
--
-- Citas: regla 6 (migración versionada), regla 13 (sin window.confirm),
-- D05/E42 (throttle global emails sigue intacto).

-- 1) Campos visuales nuevos sobre email_templates
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS kicker text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS titulo_visual text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color_acento text NOT NULL DEFAULT '#0891b2',
  ADD COLUMN IF NOT EXISTS mostrar_logo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cuerpo_html_visual text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS firma text,
  ADD COLUMN IF NOT EXISTS incluir_tabla_envio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_text text,
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS layout_version text NOT NULL DEFAULT 'manaxer-v1';

COMMENT ON COLUMN public.email_templates.kicker IS 'Línea superior en mayúsculas (categoría) del header del mail.';
COMMENT ON COLUMN public.email_templates.titulo_visual IS 'H1 grande del mail (puede diferir del subject del email).';
COMMENT ON COLUMN public.email_templates.color_acento IS 'Hex color del kicker, los links y el botón CTA.';
COMMENT ON COLUMN public.email_templates.mostrar_logo IS 'Si true, renderiza el logo de Gestión Global arriba del kicker.';
COMMENT ON COLUMN public.email_templates.cuerpo_html_visual IS 'HTML rich text del cuerpo (output de TipTap). Variables {{var}} se substituyen en dispatch.';
COMMENT ON COLUMN public.email_templates.firma IS 'Línea opcional entre el cuerpo y el footer (ej "Equipo Gestión Global").';
COMMENT ON COLUMN public.email_templates.incluir_tabla_envio IS 'Si true, agrega tabla FROM/REPLY-TO al pie del mail.';
COMMENT ON COLUMN public.email_templates.cta_text IS 'Texto del botón CTA opcional.';
COMMENT ON COLUMN public.email_templates.cta_url IS 'URL del botón CTA opcional (puede contener {{vars}}).';
COMMENT ON COLUMN public.email_templates.layout_version IS 'Versión del layout para futuras migraciones del template.';

-- 2) Seed inicial — usar el body_html actual como cuerpo visual y kickers/títulos por slug
UPDATE public.email_templates SET
  cuerpo_html_visual = CASE
    WHEN cuerpo_html_visual = '' THEN body_html
    ELSE cuerpo_html_visual
  END,
  kicker = CASE
    WHEN kicker = '' THEN
      CASE slug
        WHEN 'bienvenida-administracion'        THEN 'GESTIÓN GLOBAL'
        WHEN 'comprobante-emitido'              THEN 'FACTURACIÓN'
        WHEN 'tramite-creado'                   THEN 'TRÁMITE RECIBIDO'
        WHEN 'tramite-resuelto'                 THEN 'TRÁMITE RESUELTO'
        WHEN 'curso-inscripcion-confirmada'     THEN 'CAMPUS'
        WHEN 'formulario-submission-recibido'   THEN 'SOLICITUD RECIBIDA'
        WHEN 'solicitud-derivada-gestoria'      THEN 'NUEVA DERIVACIÓN'
        WHEN 'nuevo-servicio-activado'          THEN 'SERVICIO ACTIVADO'
        ELSE upper(replace(slug, '-', ' '))
      END
    ELSE kicker
  END,
  titulo_visual = CASE
    WHEN titulo_visual = '' THEN
      CASE slug
        WHEN 'bienvenida-administracion'        THEN '¡Bienvenido a Gestión Global!'
        WHEN 'comprobante-emitido'              THEN 'Tu comprobante está listo'
        WHEN 'tramite-creado'                   THEN 'Recibimos tu pedido'
        WHEN 'tramite-resuelto'                 THEN '¡Listo! Tu trámite fue resuelto'
        WHEN 'curso-inscripcion-confirmada'     THEN 'Te inscribimos al curso'
        WHEN 'formulario-submission-recibido'   THEN 'Recibimos tu solicitud'
        WHEN 'solicitud-derivada-gestoria'      THEN 'Nueva derivación de Gestión Global'
        WHEN 'nuevo-servicio-activado'          THEN 'Servicio activado'
        ELSE asunto
      END
    ELSE titulo_visual
  END,
  firma = CASE
    WHEN firma IS NULL THEN
      CASE
        WHEN from_casilla = 'cursos'   THEN 'Equipo de Campus · Gestión Global'
        WHEN from_casilla = 'webinar'  THEN 'Equipo de Webinars · Gestión Global'
        WHEN from_casilla = 'juridico' THEN 'Consultoría Jurídica · Gestión Global'
        ELSE 'Equipo Gestión Global'
      END
    ELSE firma
  END,
  cta_text = CASE
    WHEN cta_text IS NULL THEN
      CASE slug
        WHEN 'comprobante-emitido'              THEN 'Ver comprobante'
        WHEN 'curso-inscripcion-confirmada'     THEN 'Acceder al curso'
        WHEN 'tramite-resuelto'                 THEN 'Ver detalle'
        WHEN 'bienvenida-administracion'        THEN 'Entrar al portal'
        ELSE NULL
      END
    ELSE cta_text
  END,
  cta_url = CASE
    WHEN cta_url IS NULL THEN
      CASE slug
        WHEN 'comprobante-emitido'              THEN '{{link_descarga}}'
        WHEN 'curso-inscripcion-confirmada'     THEN '{{link_portal}}'
        WHEN 'tramite-resuelto'                 THEN '{{link_portal}}'
        WHEN 'bienvenida-administracion'        THEN 'https://gestionglobal.ar/portal'
        ELSE NULL
      END
    ELSE cta_url
  END;

-- 3) RPC para actualizar campos visuales de una plantilla (gerente only)
CREATE OR REPLACE FUNCTION public.email_template_actualizar_visual(
  p_slug                  text,
  p_kicker                text,
  p_titulo_visual         text,
  p_color_acento          text,
  p_mostrar_logo          boolean,
  p_cuerpo_html_visual    text,
  p_firma                 text,
  p_incluir_tabla_envio   boolean,
  p_cta_text              text,
  p_cta_url               text,
  p_asunto                text DEFAULT NULL
)
RETURNS public.email_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.email_templates;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede editar plantillas' USING ERRCODE = '42501';
  END IF;

  -- Validar color hex
  IF p_color_acento !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'color_acento debe ser hex #rrggbb' USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_templates SET
    kicker               = p_kicker,
    titulo_visual        = p_titulo_visual,
    color_acento         = p_color_acento,
    mostrar_logo         = p_mostrar_logo,
    cuerpo_html_visual   = p_cuerpo_html_visual,
    firma                = NULLIF(p_firma, ''),
    incluir_tabla_envio  = p_incluir_tabla_envio,
    cta_text             = NULLIF(p_cta_text, ''),
    cta_url              = NULLIF(p_cta_url, ''),
    asunto               = COALESCE(NULLIF(p_asunto, ''), asunto),
    updated_at           = now()
  WHERE slug = p_slug
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plantilla % no encontrada', p_slug USING ERRCODE = '42P01';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_template_actualizar_visual(
  text, text, text, text, boolean, text, text, boolean, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.email_template_actualizar_visual(text, text, text, text, boolean, text, text, boolean, text, text, text) IS
  'Actualiza los campos visuales (layout MANAXER) de una plantilla. Solo staff.';
