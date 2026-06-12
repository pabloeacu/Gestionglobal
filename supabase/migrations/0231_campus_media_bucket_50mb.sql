-- Bibliografía: subir PDF de hasta 50 MB (antes el bucket usaba el global). El front
-- (FileUploader maxMb) enforce 50; el bucket debe permitirlo. Idempotente.
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'campus-media';
