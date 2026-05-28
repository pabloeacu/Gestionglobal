-- ============================================================================
-- Migration: 0098_tracking_trigger_robust
-- Fecha: 2026-05-28
-- DGG-XX · Hardening del trigger tracking_linea_on_insert: cada side-effect
-- (encolar_email / encolar_push / notif_emitir / update tramites) ahora va en
-- su propio BEGIN/EXCEPTION. Un fallo de notificación no debe romper el
-- INSERT del avance. Es prerequisito de #147 (gestor_cargar_avance anon).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite           record;
  v_servicio_nombre   text;
  v_to_email          text;
  v_to_nombre         text;
  v_admin_user_id     uuid;
  v_portal_url        text;
  v_gerencia_url      text;
  v_autor_role        text;
  v_autor_admin_id    uuid;
  v_asignado_a        uuid;
  v_archivos_count    int;
BEGIN
  BEGIN
    UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = NEW.tramite_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NEW.autor_id IS NOT NULL THEN
    SELECT role, administracion_id INTO v_autor_role, v_autor_admin_id
      FROM public.profiles WHERE id = NEW.autor_id;
  END IF;

  v_archivos_count := COALESCE(array_length(NEW.archivos_urls, 1), 0);

  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now())
     AND NEW.visible_cliente = false
     AND NOT (v_autor_role = 'administrador') THEN
    RETURN NEW;
  END IF;

  SELECT t.*, s.nombre AS svc_nombre
    INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = NEW.tramite_id;

  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_asignado_a := v_tramite.asignado_a;

  v_to_email := v_tramite.solicitante_email;
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id
      FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;

  v_portal_url   := 'https://www.gestionglobal.ar/portal/mis-gestiones/' || NEW.tramite_id::text;
  v_gerencia_url := 'https://www.gestionglobal.ar/gestion/tracking/' || NEW.tramite_id::text;

  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_email(
        'tracking-recordatorio', v_to_email, v_to_nombre,
        jsonb_build_object('tipo', v_servicio_nombre, 'descripcion', NEW.descripcion,
          'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', NEW.id, 5::smallint
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF NEW.visible_cliente = true THEN
    IF v_to_email IS NOT NULL THEN
      BEGIN
        PERFORM public.encolar_email(
          'tracking-avance-cliente', v_to_email, v_to_nombre,
          jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
            'tipo', v_servicio_nombre, 'descripcion', NEW.descripcion, 'portal_url', v_portal_url),
          v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', NEW.id, 3::smallint
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF v_admin_user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_servicio_nombre,
          substring(NEW.descripcion, 1, 140), NULL, v_portal_url);
      EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance',
          'Nuevo avance: ' || v_servicio_nombre, substring(NEW.descripcion, 1, 200),
          '/portal/mis-gestiones/' || NEW.tramite_id::text,
          jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id, 'servicio', v_servicio_nombre));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  IF v_autor_role = 'administrador' THEN
    DECLARE
      v_titulo text := CASE WHEN v_archivos_count > 0 THEN 'Cliente subió archivos: ' || v_servicio_nombre
        ELSE 'Cliente agregó nota: ' || v_servicio_nombre END;
      v_cuerpo text := COALESCE(NULLIF(v_to_nombre, ''), 'El administrador') || ' · '
        || substring(NEW.descripcion, 1, 160)
        || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END;
      v_url text := '/gestion/tracking/' || NEW.tramite_id::text;
      v_payload jsonb := jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id,
        'administracion_id', v_autor_admin_id, 'archivos_count', v_archivos_count);
    BEGIN
      BEGIN
        IF v_asignado_a IS NOT NULL THEN
          PERFORM private.notif_emitir(v_asignado_a, 'tracking_cliente_movimiento', v_titulo, v_cuerpo, v_url, v_payload);
        ELSE
          PERFORM private.notif_emitir_staff('tracking_cliente_movimiento', v_titulo, v_cuerpo, v_url, v_payload);
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
