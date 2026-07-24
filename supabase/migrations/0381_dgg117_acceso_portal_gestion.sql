-- ============================================================================
-- 0381 · DGG-117 · Gestión del acceso al portal desde la ficha del cliente
--        (pedido de Pablo, 2026-07-24, a raíz del caso Nogueira/E-rebotes)
--
-- Piezas BD:
--   1. RPC `cliente_acceso_estado` — estado del acceso del cliente para el
--      ícono de 3 estados de la ficha (rojo = sin usuario · amarillo = usuario
--      que nunca ingresó · verde = usuario que ya ingresó). El dato
--      `last_sign_in_at` vive en auth.users (inaccesible por PostgREST), por
--      eso la RPC es SECURITY DEFINER con guard is_staff (R12: superficie
--      exclusiva de gerencia, sin eje de tenencia).
--   2. Templates de email del wizard "Corregir mail de acceso":
--      · acceso-email-actualizado        → al mail NUEVO, CON credenciales
--        (para clientes que nunca ingresaron: password temporal regenerada).
--      · acceso-email-actualizado-aviso  → al mail NUEVO, SIN credenciales
--        (para clientes que ya ingresaron: su contraseña sigue vigente).
--      Dos templates en vez de condicionales en el HTML (el renderer de
--      dispatch-emails no soporta lógica, sólo {{variables}}).
--
-- Las mutaciones del acceso (regenerar password, cambiar email de login)
-- NO van por RPC: requieren la Admin API de Auth → edge functions
-- `reenviar-bienvenida` y `corregir-email-acceso` (staff-gated), mismo
-- patrón que alta-cliente-portal.
-- ============================================================================

-- ── 1 · RPC estado del acceso (para el ícono de la ficha) ────────────────────
CREATE OR REPLACE FUNCTION public.cliente_acceso_estado(p_administracion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_email_login text;
  v_last_sign_in timestamptz;
BEGIN
  -- Sólo gerencia/operación: expone email de login y actividad del usuario.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede consultar el estado de acceso'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.user_id INTO v_user_id
  FROM public.administraciones a
  WHERE a.id = p_administracion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administración no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('tiene_user', false, 'ya_ingreso', false,
      'email_login', NULL, 'last_sign_in_at', NULL);
  END IF;

  SELECT u.email, u.last_sign_in_at INTO v_email_login, v_last_sign_in
  FROM auth.users u WHERE u.id = v_user_id;
  IF NOT FOUND THEN
    -- user_id apunta a un user borrado (huérfano): tratamos como sin acceso.
    RETURN jsonb_build_object('tiene_user', false, 'ya_ingreso', false,
      'email_login', NULL, 'last_sign_in_at', NULL);
  END IF;

  RETURN jsonb_build_object(
    'tiene_user', true,
    'ya_ingreso', v_last_sign_in IS NOT NULL,
    'email_login', v_email_login,
    'last_sign_in_at', v_last_sign_in
  );
END; $$;

REVOKE ALL ON FUNCTION public.cliente_acceso_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_acceso_estado(uuid) TO authenticated, service_role;

-- ── 2 · Template: email de acceso actualizado CON credenciales ───────────────
INSERT INTO public.email_templates (
  slug, nombre, asunto, from_casilla, activo, descripcion,
  kicker, titulo_visual, color_acento, mostrar_logo, layout_version,
  cta_text, cta_url, firma, variables, cuerpo_html_visual, body_html
) VALUES (
  'acceso-email-actualizado',
  'Acceso actualizado (con credenciales)',
  'Actualizamos tu email de acceso al portal, {{nombre_administracion}}',
  'general', true,
  'DGG-117: se envía al email NUEVO cuando gerencia corrige el mail de acceso de un cliente que nunca ingresó al portal. Incluye credenciales regeneradas.',
  'Tu acceso fue actualizado',
  'Actualizamos tu email de acceso',
  '#0891b2', true, 'manaxer-v1',
  'Ingresar al portal', '{{link_portal}}',
  'Equipo Gestión Global',
  '["nombre_administracion","email_nuevo","email_anterior","password_temporal","link_portal"]'::jsonb,
  '<p>Hola <strong>{{nombre_administracion}}</strong>,</p>
<p>Te escribimos para avisarte que actualizamos el email de acceso a tu <strong>Portal del Administrador</strong> de Gestión Global.</p>
<p style="margin:14px 0 6px"><strong>El cambio realizado:</strong></p>
<ul style="margin:4px 0 16px 18px;padding:0;line-height:1.7">
  <li>Email anterior: <strong>{{email_anterior}}</strong></li>
  <li>Email nuevo (tu usuario desde ahora): <strong>{{email_nuevo}}</strong></li>
</ul>
<p>Para que puedas entrar sin vueltas, también generamos una <strong>contraseña temporal</strong>:</p>
<p style="margin:10px 0;padding:12px 16px;background:#f1f5f9;border-radius:10px;font-size:16px"><strong>Usuario:</strong> {{email_nuevo}}<br/><strong>Contraseña temporal:</strong> {{password_temporal}}</p>
<p>Al ingresar, te recomendamos cambiarla desde tu perfil por una propia.</p>
<p>Si no pediste este cambio, respondé este correo y lo revisamos al instante.</p>',
  '<p>Hola {{nombre_administracion}}: actualizamos tu email de acceso al portal. Usuario nuevo: {{email_nuevo}} (antes {{email_anterior}}). Contraseña temporal: {{password_temporal}}. Ingresá en {{link_portal}} y cambiala desde tu perfil.</p>'
)
ON CONFLICT (slug) DO NOTHING;

-- ── 3 · Template: email de acceso actualizado SIN credenciales ───────────────
INSERT INTO public.email_templates (
  slug, nombre, asunto, from_casilla, activo, descripcion,
  kicker, titulo_visual, color_acento, mostrar_logo, layout_version,
  cta_text, cta_url, firma, variables, cuerpo_html_visual, body_html
) VALUES (
  'acceso-email-actualizado-aviso',
  'Acceso actualizado (aviso, sin credenciales)',
  'Actualizamos tu email de acceso al portal, {{nombre_administracion}}',
  'general', true,
  'DGG-117: se envía al email NUEVO cuando gerencia corrige el mail de acceso de un cliente que YA ingresó al portal. Su contraseña no cambia.',
  'Tu acceso fue actualizado',
  'Actualizamos tu email de acceso',
  '#0891b2', true, 'manaxer-v1',
  'Ingresar al portal', '{{link_portal}}',
  'Equipo Gestión Global',
  '["nombre_administracion","email_nuevo","email_anterior","link_portal"]'::jsonb,
  '<p>Hola <strong>{{nombre_administracion}}</strong>,</p>
<p>Te escribimos para avisarte que actualizamos el email de acceso a tu <strong>Portal del Administrador</strong> de Gestión Global.</p>
<p style="margin:14px 0 6px"><strong>El cambio realizado:</strong></p>
<ul style="margin:4px 0 16px 18px;padding:0;line-height:1.7">
  <li>Email anterior: <strong>{{email_anterior}}</strong></li>
  <li>Email nuevo (tu usuario desde ahora): <strong>{{email_nuevo}}</strong></li>
</ul>
<p>Tu <strong>contraseña sigue siendo la misma</strong> — sólo cambió el usuario con el que ingresás. Si no la recordás, podés restablecerla desde la pantalla de ingreso con "¿Olvidaste tu contraseña?".</p>
<p>Si no pediste este cambio, respondé este correo y lo revisamos al instante.</p>',
  '<p>Hola {{nombre_administracion}}: actualizamos tu email de acceso al portal. Usuario nuevo: {{email_nuevo}} (antes {{email_anterior}}). Tu contraseña sigue siendo la misma. Ingresá en {{link_portal}}.</p>'
)
ON CONFLICT (slug) DO NOTHING;
