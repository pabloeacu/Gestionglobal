-- ============================================================================
-- 0383 · E-GG-156 (reporte de Pablo, caso Nogueira 24/07)
--
-- El asistente "Corregir mail de acceso" mandaba, cuando el cliente NUNCA
-- ingresó, un avisito con la contraseña pero sin el formato de bienvenida.
-- Pedido de Pablo: si nunca ingresó, el correo al email NUEVO debe ser la
-- BIENVENIDA completa de siempre (credenciales + qué puede hacer + link),
-- con una línea breve que aclare que el usuario de acceso fue actualizado
-- a su pedido.
--
-- El template -aviso (caso "ya ingresó": contraseña intacta) queda como
-- está: su texto es correcto para ese único caso, y desde la edge v3 ya no
-- se envía nunca al correo viejo (decisión de Pablo: el caso de uso del
-- asistente es "el correo viejo está muerto" — avisarle ahí solo genera
-- otro rebote y ruido en el banner de rebotes).
-- ============================================================================

UPDATE public.email_templates
SET
  nombre = 'Acceso actualizado · bienvenida con credenciales',
  descripcion = 'Cambio de email de acceso para un cliente que NUNCA ingresó: bienvenida completa con las credenciales nuevas (la contraseña se regenera). Enviado por la edge corregir-email-acceso.',
  asunto = 'Tu acceso al Portal del Administrador — usuario actualizado, {{nombre_administracion}}',
  kicker = 'Tu cuenta está lista',
  titulo_visual = 'Actualizamos tu usuario de acceso',
  cta_text = 'Ingresar al portal',
  cta_url = '{{link_portal}}',
  firma = 'Equipo Gestión Global',
  variables = '["nombre_administracion","email_nuevo","email_anterior","password_temporal","link_portal"]'::jsonb,
  cuerpo_html_visual = $HTML$<p>Hola <strong>{{nombre_administracion}}</strong>,</p>
<p>A tu pedido, actualizamos el <strong>email con el que ingresás</strong> al Portal del Administrador: tu usuario ya no es {{email_anterior}} sino <strong>{{email_nuevo}}</strong>.</p>
<p>Como todavía no habías ingresado, te dejamos acá abajo <strong>todo lo que necesitás para tu primer acceso</strong>. Desde tu portal vas a poder:</p>
<ul style="margin:8px 0 16px 18px;padding:0;line-height:1.7">
  <li>Acceder a <strong>todos los servicios</strong> que tenemos disponibles</li>
  <li>Hacer el <strong>seguimiento en tiempo real</strong> de cada gestión</li>
  <li>Recibir <strong>notificaciones</strong> de avances, vencimientos y cobranzas</li>
  <li>Ver tu <strong>cuenta corriente</strong>, descargar comprobantes y mucho más</li>
</ul>
<div style="background:#ecfeff;border-left:3px solid #06b6d4;padding:14px 16px;margin:18px 0;border-radius:0 8px 8px 0">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#0e7490">Tus credenciales de acceso</p>
  <p style="margin:0;font-size:14px"><strong>Sitio:</strong> <a href="{{link_portal}}" style="color:#0e7490">{{link_portal}}</a></p>
  <p style="margin:6px 0 0;font-size:14px"><strong>Usuario:</strong> {{email_nuevo}}</p>
  <p style="margin:6px 0 0;font-size:14px"><strong>Contraseña temporal:</strong> <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;background:#fff;padding:3px 8px;border-radius:4px;border:1px solid #cffafe">{{password_temporal}}</code></p>
</div>
<p style="font-size:13px;color:#475569">🔒 Por tu seguridad, te recomendamos cambiar la contraseña en el primer ingreso desde <strong>Mi cuenta → Seguridad</strong>.</p>
<p>Si no pediste este cambio, respondé este correo y lo revisamos al instante.</p>
<p style="margin:18px 0 0">Un abrazo,<br><strong>El equipo de Gestión Global</strong></p>$HTML$,
  body_html = $HTML$<p>Hola {{nombre_administracion}},</p>
<p>A tu pedido, actualizamos el email con el que ingresás al Portal del Administrador: tu usuario ya no es {{email_anterior}} sino {{email_nuevo}}.</p>
<p>Credenciales de acceso — Sitio: {{link_portal}} · Usuario: {{email_nuevo}} · Contraseña temporal: {{password_temporal}}</p>
<p>Por tu seguridad, cambiá la contraseña en el primer ingreso desde Mi cuenta → Seguridad. Si no pediste este cambio, respondé este correo.</p>
<p>Equipo Gestión Global</p>$HTML$,
  body_text = 'Hola {{nombre_administracion}}: actualizamos tu usuario del Portal del Administrador. Usuario: {{email_nuevo}} (antes {{email_anterior}}). Contraseña temporal: {{password_temporal}}. Ingresá en {{link_portal}} y cambiá la contraseña en Mi cuenta → Seguridad. Si no pediste este cambio, respondé este correo.',
  updated_at = now()
WHERE slug = 'acceso-email-actualizado';

-- Verificación: el template debe existir (si el slug no está, la mig falla
-- ruidosamente en vez de dejar el flujo a medias).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.email_templates
    WHERE slug = 'acceso-email-actualizado'
      AND cuerpo_html_visual LIKE '%Contraseña temporal%'
      AND cuerpo_html_visual LIKE '%todos los servicios%'
  ) THEN
    RAISE EXCEPTION 'E-GG-156: template acceso-email-actualizado no quedó como bienvenida completa';
  END IF;
END $$;
