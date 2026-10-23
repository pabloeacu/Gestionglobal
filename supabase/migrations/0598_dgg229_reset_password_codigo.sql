-- 0598_dgg229_reset_password_codigo.sql
-- DGG-229 / E-GG-233 · El mail de restablecer contraseña ahora muestra un CÓDIGO
-- de 6 dígitos (en vez de un link que se consumía al abrirse). Capitaliza el
-- caso NIETO/Yahoo: los escáneres/webviews de correo pre-visitan el link de
-- recovery (/auth/v1/verify) y queman el token de un solo uso antes de que el
-- usuario complete el cambio → "venció" aunque falte tiempo (Yahoo 0/7 en 30d).
-- Un código de texto no se consume con un GET de prefetch y sobrevive recargas.
--
-- La edge enviar-reset-password ahora pasa `{{codigo}}` (= generateLink
-- properties.email_otp) y `{{reset_url}}` apunta a /restablecer?email=... (sólo
-- navegación, no consume nada). La pantalla /restablecer pide el código → verifyOtp.
--
-- Sólo copy/plantilla; sin cambio de schema.

UPDATE public.email_templates
   SET cta_text = 'Cambiar mi contraseña',
       cuerpo_html_visual = $html$<p>Hola <strong>{{nombre}}</strong>,</p>
<p>Recibimos un pedido para restablecer la contraseña de tu cuenta en Gestión Global.</p>
<p>Sumamos un pasito extra <strong>por tu seguridad</strong> 🔒 — así tu cuenta queda protegida aunque alguien más llegue a ver este correo. Es rápido:</p>
<p style="margin:16px 0 6px"><strong>Este es tu código</strong> (lo vas a necesitar en la pantalla):</p>
<div style="text-align:center;margin:6px 0 16px">
  <span style="display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:14px 28px;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0b1f33">{{codigo}}</span>
</div>
<p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 18px">El código es personal y vence en 1 hora.</p>
<p style="margin:0 0 2px;font-size:14px">Tocá el botón de abajo, pegá el código y elegí tu contraseña nueva. ¡Y listo!</p>
<div style="background:#f8fafc;border-left:3px solid #0891b2;padding:12px 14px;margin:18px 0 0;border-radius:0 8px 8px 0">
  <p style="margin:0;color:#475569;font-size:13px">¿No fuiste vos? Podés ignorar este correo tranquilo: tu contraseña actual sigue funcionando y el código no sirve para nada sin este mail.</p>
</div>$html$,
       updated_at = now()
 WHERE slug = 'password-reset';
