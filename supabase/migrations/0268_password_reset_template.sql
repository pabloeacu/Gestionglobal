-- ============================================================================
-- 0268_password_reset_template.sql
-- DGG-93 (reporte JL #5) · No existía recuperación de contraseña: un usuario que
-- olvida su clave queda bloqueado (login falla y "cambiar contraseña" exige estar
-- logueado). Se agrega un flujo de restablecimiento por link (edge fn
-- enviar-reset-password + pantalla /restablecer). Este template es el correo con
-- el link, despachado por el pipeline propio (Google Workspace), no por el SMTP
-- de Supabase Auth (que este proyecto no usa: los users se crean con
-- email_confirm=true). E-GG-74: cuerpo_html_visual poblado.
-- ============================================================================
INSERT INTO public.email_templates
  (slug, asunto, nombre, descripcion, from_casilla, layout_version, kicker,
   titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual, incluir_tabla_envio,
   cta_text, cta_url, activo, body_html, body_text)
VALUES (
  'password-reset',
  'Restablecé tu contraseña · Gestión Global',
  'Restablecer contraseña',
  'Correo con el link seguro para que el usuario cree una contraseña nueva (flujo de recuperación).',
  'general', 'manaxer-v1', 'Seguridad de tu cuenta',
  'Restablecé tu contraseña', '#0891b2', true,
  '<p>Hola <strong>{{nombre}}</strong>,</p>'
  || '<p>Recibimos un pedido para restablecer la contraseña de tu cuenta en Gestión Global.</p>'
  || '<p>Tocá el botón de abajo para crear una contraseña nueva. El enlace es personal y vence en 1 hora.</p>'
  || '<div style="background:#f8fafc;border-left:3px solid #0891b2;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">'
  || '<p style="margin:0;color:#475569;font-size:13px">Si vos no pediste esto, podés ignorar este correo: tu contraseña actual sigue funcionando y nadie más puede usar este enlace.</p></div>',
  false,
  'Crear nueva contraseña', '{{reset_url}}', true,
  '<!doctype html><html><body><p>Hola {{nombre}},</p><p>Recibimos un pedido para restablecer tu contraseña en Gestión Global. Creá una nueva acá (el enlace vence en 1 hora):</p><p><a href="{{reset_url}}">Crear nueva contraseña</a></p><p>Si no lo pediste, ignorá este correo.</p></body></html>',
  'Hola {{nombre}}, para restablecer tu contraseña en Gestión Global entrá a: {{reset_url}} (vence en 1 hora). Si no lo pediste, ignorá este correo.'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version,
  body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, activo = true;
