-- ============================================================================
-- 0259_fix_email_docs_revision_y_ruta.sql
-- DGG-89 (reporte JL #1) · "Pedir y dejar en revisión" mandaba un mail VACÍO (sólo
-- logo): la plantilla solicitud-docs-revision está en layout 'manaxer-v1' pero con
-- los campos visuales vacíos; el dispatcher renderiza esos campos (vacíos) e ignora
-- el body_html viejo donde vivía {{mensaje}}. Fix de DATOS: poblar titulo_visual /
-- kicker / cuerpo_html_visual (con el detalle {{mensaje}} + "respondé este correo").
-- Además: el notif/push del cliente apuntaban a /portal/solicitudes (ruta inexistente
-- → rebote). Se corrige a /portal (válida). Esta rama NO abre trámite: el canal es
-- el mail (responder); no se crea artefacto de portal por diseño.
-- ============================================================================

-- (A) Poblar los campos visuales manaxer del template
UPDATE public.email_templates
   SET titulo_visual = 'Necesitamos algo más para tu solicitud',
       kicker        = 'Documentación pendiente',
       cuerpo_html_visual =
         '<p>Hola <strong>{{nombre}}</strong>,</p>'
         || '<p>Estamos revisando tu solicitud y, para poder avanzar, necesitamos que nos envíes lo siguiente:</p>'
         || '<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:8px;">'
         || '<p style="margin:0 0 4px;font-weight:600;color:#92400e;">Qué necesitamos</p>'
         || '<p style="margin:0;white-space:pre-wrap;color:#1e293b;">{{mensaje}}</p>'
         || '</div>'
         || '<p><strong>Respondé este correo</strong> con lo solicitado y seguimos con tu gestión. ¡Gracias!</p>'
 WHERE slug = 'solicitud-docs-revision';

-- (B) Corregir la ruta rota del notif/push (resto del cuerpo idéntico al vigente)
CREATE OR REPLACE FUNCTION public.solicitud_pedir_docs_revision(p_solicitud_id uuid, p_mensaje text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
              '/portal',
              jsonb_build_object('solicitud_id', p_solicitud_id, 'mensaje', btrim(p_mensaje)));
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (v_cli_user, 'Necesitamos documentación',
              left(btrim(p_mensaje), 140),
              '/portal');
    END IF;
  END IF;
END;
$function$;
