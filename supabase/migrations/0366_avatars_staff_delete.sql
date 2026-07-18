-- 0366 · avatars: DELETE para staff (purga pre-lanzamiento, DGG-111).
-- El bucket avatars sólo tenía avatars_own_delete (cada usuario borra el suyo,
-- carpeta = su uid). Los avatares de usuarios QA ya inexistentes quedaban
-- huérfanos sin nadie que pueda borrarlos. Staff gestiona avatares (igual que
-- en el resto de los buckets con *_staff_all): policy permanente.
CREATE POLICY avatars_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND private.is_staff());
