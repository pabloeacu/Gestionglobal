-- ============================================================================
-- 0389 · DGG-119 §6 A#2 · Defensa en profundidad: quitar EXECUTE de anon
--
-- La mig 0388 revocó solo FROM PUBLIC; el patrón de la casa (migs 0360/0363/
-- 0364/0375/0380) revoca también de anon. Sin fuga real (is_staff() y
-- auth.uid() NULL cortan igual), pero anon no tiene por qué poder ejecutarlas.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.cert_marcar_descarga_alumno(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.curso_alumnos_emails(uuid) FROM anon;
