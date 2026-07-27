-- ============================================================================
-- 0387 · DGG-118 · Bucket `email-assets` para adjuntos de templates de email
--
-- La guía de bienvenida en PDF (aprobada por Pablo, 27/07) se adjunta al mail
-- `bienvenida-administracion` en sus 3 caminos (alta, reenviar-bienvenida,
-- corregir-email-acceso rama "nunca ingresó"). El dispatcher la baja de este
-- bucket con service role al momento de enviar (cola liviana: la fila de
-- email_queue guarda solo la referencia, no los bytes).
--
-- PRIVADO y sin policies (regla 2: RLS de storage.objects ya activa; sin
-- policy = solo service_role accede — nadie navega este bucket desde el
-- front). El dispatcher whitelistea qué buckets acepta como origen de
-- adjuntos: hoy, únicamente `email-assets`.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-assets', 'email-assets', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['application/pdf'];
