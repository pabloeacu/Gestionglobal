-- ============================================================================
-- 0384 · E-GG-157 · Template del blanqueo de contraseña por gerencia
--
-- Pedido de Pablo (24/07): "Blanquear contraseña" como wizard propio de la
-- ficha — genera una contraseña nueva (pisa la actual), y el mail al cliente
-- es COMO el de bienvenida (misma caja de credenciales, mismos beneficios)
-- pero diciendo "blanqueamos tu contraseña y generamos esta nueva". Camino
-- paralelo y exclusivo de gerencia respecto del "¿Olvidaste tu contraseña?"
-- del login (que sigue intacto para el autoservicio del cliente).
-- ============================================================================

INSERT INTO public.email_templates (
  slug, nombre, descripcion, asunto, from_casilla, activo,
  kicker, titulo_visual, cta_text, cta_url, firma, layout_version,
  color_acento, mostrar_logo, incluir_tabla_envio,
  variables, cuerpo_html_visual, body_html, body_text
) VALUES (
  'acceso-password-blanqueada',
  'Acceso · contraseña blanqueada por gerencia',
  'Blanqueo de contraseña iniciado por gerencia (edge blanquear-password): credenciales nuevas al email de login vigente, formato bienvenida.',
  'Tu nueva contraseña del Portal del Administrador, {{nombre_administracion}}',
  'general',
  true,
  'Tu acceso, renovado',
  'Blanqueamos tu contraseña',
  'Ingresar al portal',
  '{{link_portal}}',
  'Equipo Gestión Global',
  'manaxer-v1',
  '#0891b2',
  true,
  false,
  '["nombre_administracion","email_user","password_temporal","link_portal"]'::jsonb,
  $HTML$<p>Hola <strong>{{nombre_administracion}}</strong>,</p>
<p>A tu pedido, <strong>blanqueamos tu contraseña</strong> del Portal del Administrador y generamos esta nueva. La anterior ya no sirve.</p>
<div style="background:#ecfeff;border-left:3px solid #06b6d4;padding:14px 16px;margin:18px 0;border-radius:0 8px 8px 0">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#0e7490">Tus credenciales de acceso</p>
  <p style="margin:0;font-size:14px"><strong>Sitio:</strong> <a href="{{link_portal}}" style="color:#0e7490">{{link_portal}}</a></p>
  <p style="margin:6px 0 0;font-size:14px"><strong>Usuario:</strong> {{email_user}}</p>
  <p style="margin:6px 0 0;font-size:14px"><strong>Contraseña nueva:</strong> <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;background:#fff;padding:3px 8px;border-radius:4px;border:1px solid #cffafe">{{password_temporal}}</code></p>
</div>
<p>Te recordamos todo lo que tenés en tu portal:</p>
<ul style="margin:8px 0 16px 18px;padding:0;line-height:1.7">
  <li>Acceder a <strong>todos los servicios</strong> que tenemos disponibles</li>
  <li>Hacer el <strong>seguimiento en tiempo real</strong> de cada gestión</li>
  <li>Recibir <strong>notificaciones</strong> de avances, vencimientos y cobranzas</li>
  <li>Ver tu <strong>cuenta corriente</strong>, descargar comprobantes y mucho más</li>
</ul>
<p style="font-size:13px;color:#475569">🔒 Por tu seguridad, te recomendamos cambiar esta contraseña en tu próximo ingreso desde <strong>Mi cuenta → Seguridad</strong>.</p>
<p>Si no pediste este blanqueo, respondé este correo y lo revisamos al instante.</p>
<p style="margin:18px 0 0">Un abrazo,<br><strong>El equipo de Gestión Global</strong></p>$HTML$,
  $HTML$<p>Hola {{nombre_administracion}},</p>
<p>A tu pedido, blanqueamos tu contraseña del Portal del Administrador y generamos esta nueva. La anterior ya no sirve.</p>
<p>Credenciales — Sitio: {{link_portal}} · Usuario: {{email_user}} · Contraseña nueva: {{password_temporal}}</p>
<p>Por tu seguridad, cambiala en tu próximo ingreso desde Mi cuenta → Seguridad. Si no pediste este blanqueo, respondé este correo.</p>
<p>Equipo Gestión Global</p>$HTML$,
  'Hola {{nombre_administracion}}: blanqueamos tu contraseña del Portal del Administrador. Usuario: {{email_user}} · Contraseña nueva: {{password_temporal}}. Ingresá en {{link_portal}} y cambiala en Mi cuenta → Seguridad. Si no pediste este blanqueo, respondé este correo.'
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  asunto = EXCLUDED.asunto,
  kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual,
  cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url,
  variables = EXCLUDED.variables,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.email_templates
    WHERE slug = 'acceso-password-blanqueada' AND activo
      AND cuerpo_html_visual LIKE '%blanqueamos tu contraseña%'
  ) THEN
    RAISE EXCEPTION 'E-GG-157: template acceso-password-blanqueada no quedó creado';
  END IF;
END $$;
