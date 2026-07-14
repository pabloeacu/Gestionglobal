-- 0337 · E-GG-111 (doc JL wave 6 · P8-A + barrido fugas-email): FUGA CRÍTICA de
-- datos internos al cliente por el email "tracking-recordatorio".
--
-- Causa raíz: public.tracking_linea_on_insert() dispara el email de recordatorio
-- al CLIENTE (v_to_email = login del admin/solicitante) para CUALQUIER línea con
-- `alerta_en > now()`, IGNORANDO `visible_cliente`. La derivación a gestoría
-- (solicitud_derivar_v2/v3) crea una línea INTERNA (visible_cliente=false) con
-- alarma futura de seguimiento y descripción que embebe el email del gestor
-- ("Envío a sector de gestoría — destinatario: <gestor@…>") + las Observaciones
-- internas del staff. Resultado: el cliente recibía por mail el email del gestor
-- y notas internas. YA MATERIALIZADO EN PRODUCCIÓN (email_queue 2026-07-11/13).
-- Mismo trigger permitía filtrar una "nota interna del equipo" (visible_cliente
-- sin tildar) si el gerente le ponía una "alerta futura".
--
-- Fix quirúrgico: la rama de recordatorio sólo debe mailear al cliente cuando la
-- línea es realmente visible para él → agregar `AND NEW.visible_cliente = true`.
-- Se preserva el recordatorio legítimo: una línea client-visible con alarma futura
-- (creada por staff vía tracking_agregar_linea) sigue avisando al cliente.
-- CREATE OR REPLACE con la MISMA firma (trigger fn sin args) → sin overload (R16 ok).

CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite record; v_servicio_nombre text; v_to_email text; v_to_nombre text;
  v_autor_role text; v_autor_admin_id uuid; v_archivos_count int;
BEGIN
  BEGIN UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = NEW.tramite_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NEW.autor_id IS NOT NULL THEN
    SELECT role, administracion_id INTO v_autor_role, v_autor_admin_id FROM public.profiles WHERE id = NEW.autor_id;
  END IF;
  v_archivos_count := COALESCE(array_length(NEW.archivos_urls, 1), 0);
  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now()) AND NEW.visible_cliente = false
     AND NOT (v_autor_role = 'administrador') AND NEW.categoria <> 'gestor_avance' THEN
    RETURN NEW;
  END IF;
  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t LEFT JOIN public.servicios s ON s.id = t.servicio_id WHERE t.id = NEW.tramite_id;
  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_tramite.administracion_id IS NOT NULL THEN
    v_to_email := public.admin_login_email(v_tramite.administracion_id);
  END IF;
  v_to_email := COALESCE(NULLIF(v_to_email,''), NULLIF(v_tramite.solicitante_email,''));
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  -- E-GG-111: SOLO mailear el recordatorio al cliente si la línea es visible para él.
  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL
     AND NEW.visible_cliente = true THEN
    BEGIN
      PERFORM public.encolar_email('tracking-recordatorio', v_to_email, v_to_nombre,
        jsonb_build_object('tipo', v_servicio_nombre, 'descripcion', NEW.descripcion,
          'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', NEW.id, 5::smallint);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF NEW.visible_cliente = true THEN
    PERFORM private.tracking_notificar_avance_cliente(NEW.id);
  END IF;
  IF v_autor_role = 'administrador' THEN
    DECLARE
      v_titulo text := CASE WHEN v_archivos_count > 0 THEN 'Cliente subió archivos: ' || v_servicio_nombre ELSE 'Cliente agregó nota: ' || v_servicio_nombre END;
      v_cuerpo text := COALESCE(NULLIF(v_to_nombre, ''), 'El administrador') || ' · ' || substring(NEW.descripcion, 1, 160)
        || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END;
    BEGIN
      PERFORM public.notify_all_gerentes('tracking_cliente_movimiento', v_titulo, v_cuerpo,
        '/gestion/tracking/' || NEW.tramite_id::text,
        jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id, 'administracion_id', v_autor_admin_id, 'archivos_count', v_archivos_count),
        true, 'gerencia-notif-generica', NULL, 3::smallint, 'tracking_lineas', NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF NEW.categoria = 'gestor_avance' THEN
    BEGIN
      PERFORM public.notify_all_gerentes('tracking_gestor_avance',
        'Aporte de gestoría PENDIENTE de revisión: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 200) || CASE WHEN v_archivos_count > 0 THEN ' (' || v_archivos_count || ' archivo/s)' ELSE '' END,
        '/gestion/tracking/' || NEW.tramite_id::text,
        jsonb_build_object('tramite_id', NEW.tramite_id, 'linea_id', NEW.id, 'servicio', v_servicio_nombre, 'archivos_count', v_archivos_count, 'moderacion', 'pendiente'),
        true, 'gerencia-notif-generica', NULL, 3::smallint, 'tracking_lineas', NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$function$;
