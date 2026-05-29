-- ============================================================================
-- Migration: 0125_solicitud_rechazo_y_rls_frases
-- Fecha: 2026-05-28
-- (a) Fix RLS faltante en frases_dispatch_log (regla 2)
-- (b) Estado 'rechazada' en solicitudes + columnas motivo + RPC solicitud_rechazar
-- (c) Email template seed: solicitud-rechazada
-- ============================================================================

-- (a) ---------------------------------------------------------------------
ALTER TABLE public.frases_dispatch_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frases_dispatch_log_read_gerente ON public.frases_dispatch_log;
CREATE POLICY frases_dispatch_log_read_gerente ON public.frases_dispatch_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'gerente'));

-- (b) ---------------------------------------------------------------------
ALTER TABLE public.solicitudes
  ADD COLUMN IF NOT EXISTS motivo_rechazo  text,
  ADD COLUMN IF NOT EXISTS rechazada_at    timestamptz,
  ADD COLUMN IF NOT EXISTS rechazada_por   uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.solicitudes.motivo_rechazo IS
  'N2 · texto que se le muestra al solicitante explicando por qué se rechazó. Visible en email + portal.';

CREATE OR REPLACE FUNCTION public.solicitud_rechazar(
  p_solicitud_id uuid,
  p_motivo       text
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
    RAISE EXCEPTION 'Solo gerencia puede rechazar solicitudes';
  END IF;

  SELECT * INTO v_solicitud FROM public.solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud % no existe', p_solicitud_id;
  END IF;
  IF v_solicitud.estado IN ('activada','rechazada','descartada') THEN
    RAISE EXCEPTION 'No se puede rechazar (estado: %)', v_solicitud.estado;
  END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'Motivo de rechazo requerido';
  END IF;

  UPDATE public.solicitudes
     SET estado        = 'rechazada',
         motivo_rechazo = btrim(p_motivo),
         rechazada_at   = now(),
         rechazada_por  = v_user_id,
         updated_at     = now()
   WHERE id = p_solicitud_id;

  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para
  ) VALUES (
    v_solicitud.solicitante_email,
    v_solicitud.solicitante_nombre,
    'Tu solicitud no pudo ser aceptada',
    'workflow',
    'solicitud-rechazada',
    jsonb_build_object(
      'nombre',          v_solicitud.solicitante_nombre,
      'servicio_slug',   v_solicitud.servicio_slug,
      'motivo',          btrim(p_motivo),
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
      VALUES (v_cli_user, 'solicitud_rechazada',
              'Tu solicitud fue rechazada',
              btrim(p_motivo),
              '/portal/solicitudes',
              jsonb_build_object('solicitud_id', p_solicitud_id, 'motivo', btrim(p_motivo)));
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (v_cli_user, 'Solicitud rechazada',
              left(btrim(p_motivo), 140),
              '/portal/solicitudes');
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitud_rechazar(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.solicitud_rechazar(uuid, text) TO authenticated;

-- (c) ---------------------------------------------------------------------
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, activo, descripcion)
SELECT
  'solicitud-rechazada',
  'Solicitud rechazada',
  'Tu solicitud no pudo ser aceptada · Gestión Global',
  $$<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0e7490">Tu solicitud no pudo ser aceptada</h1>
      <p>Hola {{nombre}}, recibimos tu solicitud del <strong>{{servicio_slug}}</strong> del {{fecha_solicitud}}, pero no podemos avanzar con ella tal cual fue enviada.</p>
      <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#991b1b">Motivo</p>
        <p style="margin:0;color:#0f172a;white-space:pre-wrap">{{motivo}}</p>
      </div>
      <p>Si querés que la veamos de nuevo, podés iniciar una nueva solicitud con la información corregida.</p>
      <p style="margin-top:24px;font-size:13px;color:#64748b">Gracias por contar con nosotros.<br/><strong>Equipo Gestión Global</strong></p>
    </div>
  </body></html>$$,
  $$Hola {{nombre}}, tu solicitud del {{servicio_slug}} ({{fecha_solicitud}}) no pudo ser aceptada.

Motivo: {{motivo}}

Si querés, podés iniciar una nueva solicitud con la información corregida.

— Equipo Gestión Global$$,
  'general',
  true,
  'N2 · enviada cuando gerencia rechaza una solicitud con motivo.'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = 'solicitud-rechazada');
