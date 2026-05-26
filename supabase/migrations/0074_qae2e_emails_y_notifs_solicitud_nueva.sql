-- 0074 · Auditoría QA-E2E · fix EGG-QA-02 + EGG-QA-03 + EGG-QA-04
--
-- Aplicada el 2026-05-26 (via apply_migration). Esta copia versionada
-- documenta el cambio.
--
-- Contexto:
-- - EGG-QA-02 (Alto): el trigger crear_tramite_desde_submission_auto generaba
--   la solicitud + notif in-app a gerentes, pero NO encolaba acuse al
--   solicitante. La plantilla 'formulario-submission-recibido' existía sin
--   disparador.
-- - EGG-QA-03 (Medio): _notif_solicitud_nueva_trg usaba el SLUG técnico
--   ("matriculacion-rpac") en el cuerpo de la notificación. Debe usar el
--   título humano del formulario ("Inscripción al RPAC").
-- - EGG-QA-04 (Medio): no se enviaba email a gerencia cuando llegaba
--   solicitud nueva. Decisión del usuario: implementar.

-- 1) Template nuevo
INSERT INTO public.email_templates (nombre, slug, asunto, body_html, body_text, from_casilla, reply_to, activo)
VALUES (
  'Solicitud nueva (gerencia)',
  'solicitud-nueva-gerencia',
  'Nueva solicitud · {{formulario_titulo}}',
  '<div style="font-family:Inter,system-ui,sans-serif;color:#0d1e2f;line-height:1.55"><h2 style="margin:0 0 8px;color:#009eca">Nueva solicitud recibida</h2><p style="margin:0 0 16px">Un visitante completó el formulario <strong>{{formulario_titulo}}</strong>.</p><table style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr><td style="padding:6px 0;color:#5b6b7d">Solicitante</td><td style="padding:6px 0"><strong>{{solicitante_nombre}}</strong></td></tr><tr><td style="padding:6px 0;color:#5b6b7d">Email</td><td style="padding:6px 0">{{solicitante_email}}</td></tr><tr><td style="padding:6px 0;color:#5b6b7d">Teléfono</td><td style="padding:6px 0">{{solicitante_telefono}}</td></tr></table><p style="margin:0 0 16px"><a href="https://www.gestionglobal.ar{{solicitud_url}}" style="background:#009eca;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Abrir solicitud</a></p><p style="margin:16px 0 0;font-size:12px;color:#5b6b7d">Notificación automática para el equipo de Gestión Global.</p></div>',
  'Nueva solicitud · {{formulario_titulo}}. Solicitante: {{solicitante_nombre}} ({{solicitante_email}}). Abrir: https://www.gestionglobal.ar{{solicitud_url}}',
  'info', NULL, true
)
ON CONFLICT (slug) DO UPDATE SET asunto = EXCLUDED.asunto, body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, activo = true;

-- 2) Trigger refactor: acuse al solicitante + email a cada gerente
CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_form record;
  v_apellido text;
  v_nombre text;
  v_nombre_completo text;
  v_solicitud_id uuid;
  v_staff record;
BEGIN
  SELECT id, slug, titulo, categoria, servicio_id INTO v_form FROM public.formularios WHERE id = NEW.formulario_id;
  IF v_form.categoria NOT IN ('tramite','servicio','consulta') THEN RETURN NEW; END IF;

  v_apellido := NULLIF(trim(COALESCE(NEW.datos->>'apellido', '')), '');
  v_nombre   := NULLIF(trim(COALESCE(NEW.datos->>'nombre', '')), '');
  v_nombre_completo := COALESCE(NEW.nombre_contacto, NULLIF(trim(concat_ws(' ', v_apellido, v_nombre)), ''), NEW.email_contacto, 'sin contacto');

  INSERT INTO public.solicitudes (formulario_submission_id, servicio_solicitado_id, solicitante_nombre, solicitante_email, solicitante_telefono, servicio_slug, estado, cliente_id)
  VALUES (NEW.id, v_form.servicio_id, v_nombre_completo, NEW.email_contacto, NEW.telefono_contacto, v_form.slug, 'recibida', NEW.administracion_id)
  RETURNING id INTO v_solicitud_id;

  -- EGG-QA-02
  IF NEW.email_contacto IS NOT NULL AND length(trim(NEW.email_contacto)) > 0 THEN
    BEGIN
      INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, programado_para, administracion_id, related_table, related_id)
      VALUES ('workflow', 'formulario-submission-recibido', NEW.email_contacto, v_nombre_completo,
        jsonb_build_object('nombre', COALESCE(v_nombre, v_nombre_completo)),
        2, 0, 3, now(), NEW.administracion_id, 'solicitudes', v_solicitud_id);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'No se pudo encolar acuse al solicitante: %', SQLERRM; END;
  END IF;

  -- EGG-QA-04
  FOR v_staff IN
    SELECT u.id, u.email FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE p.role IN ('gerente','operador') AND u.email IS NOT NULL AND length(trim(u.email)) > 0
  LOOP
    BEGIN
      INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, programado_para, related_table, related_id)
      VALUES ('workflow', 'solicitud-nueva-gerencia', v_staff.email, NULL,
        jsonb_build_object('formulario_titulo', v_form.titulo, 'solicitante_nombre', v_nombre_completo,
          'solicitante_email', COALESCE(NEW.email_contacto, '—'), 'solicitante_telefono', COALESCE(NEW.telefono_contacto, '—'),
          'solicitud_url', '/gerencia/solicitudes/' || v_solicitud_id::text),
        3, 0, 3, now(), 'solicitudes', v_solicitud_id);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'No se pudo encolar aviso a gerencia (%): %', v_staff.email, SQLERRM; END;
  END LOOP;

  RETURN NEW;
END; $function$;

-- 3) EGG-QA-03 notif body humano
CREATE OR REPLACE FUNCTION public._notif_solicitud_nueva_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_form_titulo text;
BEGIN
  SELECT f.titulo INTO v_form_titulo
  FROM public.formulario_submissions fs JOIN public.formularios f ON f.id = fs.formulario_id
  WHERE fs.id = NEW.formulario_submission_id;

  PERFORM private.notif_emitir_staff('solicitud_nueva',
    'Nueva solicitud · ' || COALESCE(NEW.solicitante_nombre, 'sin nombre'),
    COALESCE(v_form_titulo, NULLIF(NEW.servicio_slug, ''), 'Servicio sin identificar') || COALESCE(' · ' || NEW.solicitante_email, ''),
    '/gerencia/solicitudes/' || NEW.id::text,
    jsonb_build_object('solicitud_id', NEW.id, 'estado', NEW.estado));
  RETURN NEW;
END; $function$;

COMMENT ON FUNCTION public.crear_tramite_desde_submission_auto() IS 'EGG-QA-02+04 (2026-05-26): encola acuse + aviso gerencia.';
COMMENT ON FUNCTION public._notif_solicitud_nueva_trg() IS 'EGG-QA-03 (2026-05-26): notif body con titulo formulario.';
