-- E-GG-64 (1ª capa): las 4 policies del bucket certificado-assets
-- (staff_insert/read/update/delete_cert_assets) se crearon TO PUBLIC en vez de
-- TO authenticated. Su expresión llama private.is_staff(); como aplican a TODOS
-- los roles (incl. anon) y anon NO puede ejecutar esa función, cualquier
-- operación anon sobre storage.objects (p.ej. el upload del gestor externo a
-- gestor-uploads, o uploads públicos de formularios) fallaba con
-- "permission denied for function is_staff". El bucket cert-assets es staff-only
-- → estas policies deben aplicar sólo a authenticated (staff es authenticated).
ALTER POLICY staff_insert_cert_assets ON storage.objects TO authenticated;
ALTER POLICY staff_read_cert_assets   ON storage.objects TO authenticated;
ALTER POLICY staff_update_cert_assets ON storage.objects TO authenticated;
ALTER POLICY staff_delete_cert_assets ON storage.objects TO authenticated;
