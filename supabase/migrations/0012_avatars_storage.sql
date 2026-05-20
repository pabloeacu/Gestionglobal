-- ============================================================================
-- 0012_avatars_storage · Bucket público "avatars" para fotos de perfil
-- (Mi perfil — gerentes/operadores/administradores suben su propia foto).
--
-- Modelo de path: avatars/<auth.uid()>/avatar-<timestamp>.<ext>
-- El primer segmento (storage.foldername(name)[1]) debe coincidir con el
-- uid autenticado para INSERT/UPDATE/DELETE — así cada usuario sólo gestiona
-- su propia carpeta. SELECT es público (regla 3: front sólo conoce anon key,
-- el bucket sirve sus blobs por URL pública sin firma).
-- ============================================================================

-- Bucket público (idempotente).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (cualquiera con el link ve el avatar; el path lleva
-- timestamp para invalidar caché al subir uno nuevo).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- INSERT: sólo authenticated en su propia carpeta (uid como primer segmento).
DROP POLICY IF EXISTS "avatars_own_insert" ON storage.objects;
CREATE POLICY "avatars_own_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- UPDATE: idem (por si pisamos el blob — aunque por timestamp casi nunca).
DROP POLICY IF EXISTS "avatars_own_update" ON storage.objects;
CREATE POLICY "avatars_own_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- DELETE: sólo el dueño borra sus blobs.
DROP POLICY IF EXISTS "avatars_own_delete" ON storage.objects;
CREATE POLICY "avatars_own_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
