-- ============================================================================
-- 0086 · Editor de certificados (DGG-29)
-- Tabla certificado_esquemas: derivaciones editables de la plantilla base.
-- Cada esquema se vincula a 0..N cursos y 0..N webinars.
-- ============================================================================

CREATE TABLE public.certificado_esquemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  descripcion text,

  -- Color de acento (HEX). El cert deriva la paleta del esquema.
  color_acento text NOT NULL DEFAULT '#0b1f33',
  color_dorado text NOT NULL DEFAULT '#a87f3c',

  -- Logo emisor (FundPlata u otra fundación)
  visible_marca_logo boolean NOT NULL DEFAULT true,
  marca_logo_url text,

  -- Sigla institucional
  visible_sigla boolean NOT NULL DEFAULT true,
  sigla_texto text NOT NULL DEFAULT 'FU.DE.CO.IN.',

  -- Texto descriptivo
  visible_texto_descriptivo boolean NOT NULL DEFAULT true,
  texto_descriptivo text NOT NULL DEFAULT 'por haber completado y aprobado satisfactoriamente el curso',

  -- Leyenda legal
  visible_leyenda_legal boolean NOT NULL DEFAULT true,
  leyenda_legal text NOT NULL DEFAULT 'Certificado emitido conforme a la habilitación de FU.DE.CO.IN., Ley N.° 14.701, Decreto N.° 1734/22 y Disposición N.° 27/23. Organizado por Gestión Global.',

  -- Firma 1 (izquierda)
  visible_firma_1 boolean NOT NULL DEFAULT true,
  firma_1_img_url text,
  firma_1_nombre text NOT NULL DEFAULT 'Dr. Pablo E. Acuña',
  firma_1_cargo text NOT NULL DEFAULT 'Coordinador Académico',

  -- Firma 2 (derecha)
  visible_firma_2 boolean NOT NULL DEFAULT true,
  firma_2_img_url text,
  firma_2_nombre text NOT NULL DEFAULT 'Pablo M. Parente',
  firma_2_cargo text NOT NULL DEFAULT 'Presidente · FU.DE.CO.IN.',

  -- Sello holográfico (logo central)
  visible_sello boolean NOT NULL DEFAULT true,
  sello_logo_url text,

  -- Watermark de fondo
  visible_watermark boolean NOT NULL DEFAULT true,
  watermark_url text,

  -- Marcador del esquema default del sistema
  es_default boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX certificado_esquemas_es_default_idx
  ON public.certificado_esquemas(es_default) WHERE es_default;

ALTER TABLE public.certificado_esquemas ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_all_esquemas
  ON public.certificado_esquemas FOR ALL
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

CREATE TRIGGER cert_esquemas_touch_updated_at
  BEFORE UPDATE ON public.certificado_esquemas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- Vinculación a cursos
-- ============================================================================
ALTER TABLE public.cursos
  ADD COLUMN cert_esquema_id uuid REFERENCES public.certificado_esquemas(id) ON DELETE SET NULL,
  ADD COLUMN cert_emite_auto boolean NOT NULL DEFAULT true;

CREATE INDEX cursos_cert_esquema_id_idx ON public.cursos(cert_esquema_id);

-- ============================================================================
-- Vinculación a webinars
-- ============================================================================
ALTER TABLE public.webinars
  ADD COLUMN cert_esquema_id uuid REFERENCES public.certificado_esquemas(id) ON DELETE SET NULL,
  ADD COLUMN cert_emite boolean NOT NULL DEFAULT false;

CREATE INDEX webinars_cert_esquema_id_idx ON public.webinars(cert_esquema_id);

-- ============================================================================
-- Snapshot al emitir (auditoría: edits posteriores no afectan certs ya emitidos)
-- ============================================================================
ALTER TABLE public.certificados
  ADD COLUMN esquema_snapshot jsonb;

COMMENT ON COLUMN public.certificados.esquema_snapshot IS
  'Snapshot del esquema en el momento de emision. Cambios futuros al esquema no afectan certificados ya emitidos.';

-- ============================================================================
-- Storage bucket privado para uploads (logos/firmas/watermark)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certificado-assets',
  'certificado-assets',
  false,
  5242880,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']
);

CREATE POLICY "staff_read_cert_assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'certificado-assets' AND private.is_staff());

CREATE POLICY "staff_insert_cert_assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'certificado-assets' AND private.is_staff());

CREATE POLICY "staff_update_cert_assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'certificado-assets' AND private.is_staff())
  WITH CHECK (bucket_id = 'certificado-assets' AND private.is_staff());

CREATE POLICY "staff_delete_cert_assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'certificado-assets' AND private.is_staff());

-- ============================================================================
-- Esquema default (semilla — reproduce el cert hardcoded actual)
-- ============================================================================
INSERT INTO public.certificado_esquemas (nombre, descripcion, es_default)
VALUES ('Institucional FU.DE.CO.IN.',
        'Esquema base institucional. Se aplica a cursos/webinars que no tengan asignado un esquema especifico.',
        true);
