-- ============================================================================
-- 0177 · JL-PREVIEW · Bucket público para imágenes de ejemplo de campos file
--
-- Pedido de José Luis (2026-06-02): mostrar un "ojito" con popover en
-- campos file del formulario público para que el usuario vea cómo luce
-- el documento que tiene que adjuntar (ej. constancia ARCA, ARBA IIBB).
--
-- Lectura pública (formularios públicos sin login). Escritura solo
-- gerentes desde el FormularioBuilder. Mismo patrón que mig 0132
-- (`formulario-descargas`).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('formulario-previews', 'formulario-previews', true, 5 * 1024 * 1024, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS formulario_previews_gerente_write ON storage.objects;
CREATE POLICY formulario_previews_gerente_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'formulario-previews'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','operador')
    )
  )
  WITH CHECK (
    bucket_id = 'formulario-previews'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','operador')
    )
  );
