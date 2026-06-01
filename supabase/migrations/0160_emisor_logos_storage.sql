-- ============================================================================
-- 0160_emisor_logos_storage · Bucket público "emisor-logos" para los logos
-- de cada emisor fiscal en arca_emisores (DGG-31 multi-emisor).
--
-- Modelo de path: emisor-logos/<emisor_id>/logo-<timestamp>.<ext>
-- SELECT público (los PDFs y la UI los leen sin firma). INSERT/UPDATE/DELETE
-- sólo staff (gerente/operador) — cualquier emisor, cualquier carpeta.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('emisor-logos', 'emisor-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública.
DROP POLICY IF EXISTS "emisor_logos_public_read" ON storage.objects;
CREATE POLICY "emisor_logos_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'emisor-logos');

-- Helper: chequeo inline staff (private.is_staff no es visible desde RLS
-- de storage.objects). Usamos EXISTS contra public.profiles.
-- INSERT: sólo staff.
DROP POLICY IF EXISTS "emisor_logos_staff_insert" ON storage.objects;
CREATE POLICY "emisor_logos_staff_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'emisor-logos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gerente', 'operador')
        AND activo = true
    )
  );

-- UPDATE: sólo staff.
DROP POLICY IF EXISTS "emisor_logos_staff_update" ON storage.objects;
CREATE POLICY "emisor_logos_staff_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'emisor-logos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gerente','operador') AND activo = true)
  )
  WITH CHECK (
    bucket_id = 'emisor-logos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gerente','operador') AND activo = true)
  );

-- DELETE: sólo staff.
DROP POLICY IF EXISTS "emisor_logos_staff_delete" ON storage.objects;
CREATE POLICY "emisor_logos_staff_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'emisor-logos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gerente','operador') AND activo = true)
  );
