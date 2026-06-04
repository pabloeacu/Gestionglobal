-- ============================================================================
-- 0191 · E-GG-49 · Bucket gestor-uploads público
--
-- Bug (Pablo 2026-06-04): el adjunto del gestor no abre. La URL pública daba
-- 404 "Bucket not found" porque el bucket gestor-uploads se creó privado
-- (mig 0095) pero el código siempre usó getPublicUrl() — la URL pública no
-- funciona sobre un bucket privado (Supabase devuelve "Bucket not found").
--
-- Decisión (Pablo): hacer el bucket público, igual que 'tramite-documento-
-- final' que ya lo es. El path es no-adivinable (token/tracking-id +
-- timestamp + random). Funciona para gerencia, cliente y gestor externo
-- sin login. El cliente necesita abrir estos adjuntos desde su portal
-- (líneas con visible_cliente=true) y como NO es staff, no podía leer del
-- bucket privado.
--
-- Las policies de INSERT/staff existentes siguen aplicando para escritura;
-- public=true solo abre la LECTURA por el endpoint /object/public/.
-- ============================================================================

UPDATE storage.buckets
SET public = true
WHERE id = 'gestor-uploads';
