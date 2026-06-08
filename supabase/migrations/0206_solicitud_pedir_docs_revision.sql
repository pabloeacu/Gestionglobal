-- ============================================================================
-- Migration: 0206_solicitud_pedir_docs_revision
-- Fecha: 2026-06-08
-- Rediseño wizard de activación v2 (Pablo) · rama TERMINAL "Pedir documentación
-- y dejar en revisión" del Paso 2 (Q2). Deja la solicitud en 'en_revision',
-- guarda el mensaje como observación y le manda al cliente un mail (+ campana/
-- push si tiene usuario de portal) explicando qué documentación falta.
-- Espeja `solicitud_rechazar` (mig 0125) — patrón probado, 3 canales.
-- R16: nombre nuevo (no es overload de marcar_en_revision). R5/R12: SD +
-- search_path. R17: las 3 colas (email_queue/notificaciones_internas/
-- push_notifications_queue) se escriben SOLO vía SECURITY DEFINER; las dos de
-- notif NO tienen policy INSERT → el SD (owner) las desbloquea (lección E-GG-38).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.solicitud_pedir_docs_revision(
  p_solicitud_id uuid,
  p_mensaje      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitud public.solicitudes%ROWTYPE;
  v_user_id   uuid := auth.uid();
  v_role      text;
  v_cli_user  uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'gerente' THEN
    RAISE EXCEPTION 'Solo gerencia puede pedir documentación';
  END IF;

  SELECT * INTO v_solicitud FROM public.solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud % no existe', p_solicitud_id;
  END IF;
  IF v_solicitud.estado IN ('activada','rechazada','descartada') THEN
    RAISE EXCEPTION 'No se puede dejar en revisión (estado: %)', v_solicitud.estado;
  END IF;
  IF coalesce(btrim(p_mensaje),'') = '' THEN
    RAISE EXCEPTION 'Mensaje al cliente requerido';
  END IF;

  UPDATE public.solicitudes
     SET estado        = 'en_revision',
         observaciones = btrim(p_mensaje),
         updated_at    = now()
   WHERE id = p_solicitud_id;

  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para
  ) VALUES (
    v_solicitud.solicitante_email,
    v_solicitud.solicitante_nombre,
    'Necesitamos algo más para tu solicitud',
    'workflow',
    'solicitud-docs-revision',
    jsonb_build_object(
      'nombre',          v_solicitud.solicitante_nombre,
      'servicio_slug',   v_solicitud.servicio_slug,
      'mensaje',         btrim(p_mensaje),
      'fecha_solicitud', to_char(v_solicitud.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
    ),
    1,
    now()
  );

  IF v_solicitud.cliente_id IS NOT NULL THEN
    SELECT id INTO v_cli_user
      FROM public.profiles
     WHERE administracion_id = v_solicitud.cliente_id
       AND role = 'administrador'
       AND activo = true
     LIMIT 1;
    IF v_cli_user IS NOT NULL THEN
      INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
      VALUES (v_cli_user, 'solicitud_docs_revision',
              'Necesitamos documentación',
              btrim(p_mensaje),
              '/portal/solicitudes',
              jsonb_build_object('solicitud_id', p_solicitud_id, 'mensaje', btrim(p_mensaje)));
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (v_cli_user, 'Necesitamos documentación',
              left(btrim(p_mensaje), 140),
              '/portal/solicitudes');
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitud_pedir_docs_revision(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.solicitud_pedir_docs_revision(uuid, text) TO authenticated;

-- Email template (idempotente).
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, activo, descripcion)
SELECT
  'solicitud-docs-revision',
  'Solicitud · documentación requerida',
  'Necesitamos algo más para tu solicitud · Gestión Global',
  $$<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0e7490">Necesitamos algo más para avanzar</h1>
      <p>Hola {{nombre}}, recibimos tu solicitud del <strong>{{servicio_slug}}</strong> del {{fecha_solicitud}}. Para poder avanzar necesitamos que nos acerques o corrijas la siguiente documentación:</p>
      <div style="background:#ecfeff;border-left:3px solid #0891b2;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#155e75">Qué necesitamos</p>
        <p style="margin:0;color:#0f172a;white-space:pre-wrap">{{mensaje}}</p>
      </div>
      <p>Apenas la tengas, respondé este correo o volvé a enviárnosla y seguimos con tu gestión.</p>
      <p style="margin-top:24px;font-size:13px;color:#64748b">Gracias por tu paciencia.<br/><strong>Equipo Gestión Global</strong></p>
    </div>
  </body></html>$$,
  $$Hola {{nombre}}, para avanzar con tu solicitud del {{servicio_slug}} ({{fecha_solicitud}}) necesitamos:

{{mensaje}}

Apenas la tengas, respondé este correo y seguimos con tu gestión.

— Equipo Gestión Global$$,
  'general',
  true,
  'Wizard v2 · enviada cuando gerencia deja una solicitud en revisión pidiendo documentación.'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = 'solicitud-docs-revision');
