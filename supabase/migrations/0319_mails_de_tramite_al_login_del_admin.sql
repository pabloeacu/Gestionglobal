-- 0319 · Mails de trámite al email de LOGIN del admin (reporte JL 1/5, blast
-- radius). El 0309 arregló SOLO tramite_pedido_doc_crear; la auditoría §6 (agente
-- A) encontró 5 sitios más que mandaban al `solicitante_email` del form (o a
-- `administraciones.email` de la ficha) en vez del email con el que el cliente
-- entra al portal → el cliente recibe (o no) el mail en otra casilla y, al no
-- coincidir con su login, NO ve el trámite en el portal. Fix: helper único
-- admin_login_email() (mata el drift de inlinear el join en cada caller, 0309
-- incluido) + prioridad login → solicitante_email → administraciones.email.

-- Helper: email de login del administrador del cliente. NULL si el cliente no
-- tiene usuario de portal (→ los callers caen al solicitante_email, que ahí ES
-- el canal válido). SECURITY DEFINER porque lee auth.users; STABLE. R16: firma
-- nueva, sin overloads.
CREATE OR REPLACE FUNCTION public.admin_login_email(p_administracion_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.administracion_id = p_administracion_id
    AND p.role = 'administrador' AND p.activo = true
  ORDER BY (u.email IS NOT NULL) DESC, u.created_at ASC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.admin_login_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_login_email(uuid) TO authenticated;

-- (#1 CRÍTICO) tramite_pedido_doc_enviar_revision: "Recibimos tu documentación".
-- Acción del PORTAL (el cliente está logueado subiendo docs) → hermana del 0309.
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_enviar_revision(p_pedido_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_pedido public.tramite_pedidos_doc%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_admin_ok boolean;
  v_items_sin_subir int; v_items_subidos int; v_ger_user uuid;
  v_cli_email text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  SELECT * INTO v_pedido FROM public.tramite_pedidos_doc WHERE id = p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido % no existe', p_pedido_id; END IF;
  IF v_pedido.estado <> 'abierto' THEN RAISE EXCEPTION 'Este pedido ya está %', v_pedido.estado; END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = v_pedido.tramite_id;
  v_admin_ok := EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND role = 'administrador' AND administracion_id = v_tramite.administracion_id);
  IF NOT v_admin_ok AND COALESCE(v_role,'') <> 'gerente' THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT count(*) INTO v_items_sin_subir FROM public.tramite_pedidos_doc_items
   WHERE pedido_id = p_pedido_id AND estado = 'pendiente';
  IF v_items_sin_subir > 0 THEN
    RAISE EXCEPTION 'Aún faltan % archivo(s) por subir. Subí todos antes de enviar.', v_items_sin_subir;
  END IF;
  SELECT count(*) INTO v_items_subidos FROM public.tramite_pedidos_doc_items
   WHERE pedido_id = p_pedido_id AND estado = 'subido';
  UPDATE public.tramite_pedidos_doc SET enviado_para_revision_at = now() WHERE id = p_pedido_id;

  FOR v_ger_user IN SELECT id FROM public.profiles WHERE role = 'gerente' AND activo = true
  LOOP
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_ger_user, 'tramite_docs_enviados_revision',
            'Cliente envió documentación',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ': ' || v_items_subidos::text || ' archivo(s) para revisión.',
            '/gerencia/trackings/' || v_tramite.id::text,
            jsonb_build_object('tramite_id', v_tramite.id, 'pedido_id', p_pedido_id, 'items', v_items_subidos));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_ger_user, 'Cliente envió documentación',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ' — para revisar',
            '/gerencia/trackings/' || v_tramite.id::text);
  END LOOP;

  INSERT INTO public.email_queue (to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para)
  VALUES ('contacto@gestionglobal.ar', 'Gerencia Gestión Global',
    'Cliente envió documentación · Trámite ' || coalesce(v_tramite.codigo, ''),
    'workflow', 'tramite-docs-enviadas-gerencia',
    jsonb_build_object('tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'cliente_nombre', v_tramite.solicitante_nombre, 'cliente_email', v_tramite.solicitante_email,
      'items_count', v_items_subidos,
      'panel_url', '/gerencia/trackings/' || v_tramite.id::text),
    2, now());

  -- Cliente: email de login del admin → fallback solicitante_email (JL 1/5).
  v_cli_email := COALESCE(NULLIF(btrim(public.admin_login_email(v_tramite.administracion_id)),''), NULLIF(btrim(v_tramite.solicitante_email),''));
  IF v_cli_email IS NOT NULL THEN
    INSERT INTO public.email_queue (to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para)
    VALUES (v_cli_email, v_tramite.solicitante_nombre,
      'Recibimos tu documentación · Trámite ' || coalesce(v_tramite.codigo, ''),
      'workflow', 'tramite-docs-recibidas-cliente',
      jsonb_build_object('nombre', v_tramite.solicitante_nombre,
        'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
        'items_count', v_items_subidos),
      2, now());
  END IF;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente, created_at)
  VALUES (v_pedido.tramite_id, 'pendiente_revision',
    'Cliente envió ' || v_items_subidos::text || ' archivo(s) de documentación para revisión.',
    '{}'::text[], v_user_id, true, now());

  RETURN jsonb_build_object('ok', true, 'items_enviados', v_items_subidos);
END;
$function$;

-- (#2 CRÍTICO) tracking_notificar_avance_cliente: emisor CENTRAL de avances +
-- cierre + resuelto + moderación de gestor (todo el fan-out visible_cliente).
CREATE OR REPLACE FUNCTION private.tracking_notificar_avance_cliente(p_linea_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE; v_tramite record; v_svc text;
  v_to_email text; v_to_nombre text; v_admin_user_id uuid; v_portal_url text;
BEGIN
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN RETURN; END IF;
  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t LEFT JOIN public.servicios s ON s.id = t.servicio_id WHERE t.id = v_linea.tramite_id;
  v_svc := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  -- Prioridad: email de LOGIN del admin (garantiza que el cliente VEA el avance
  -- en su portal) → solicitante_email → administraciones.email (JL 1/5).
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_tramite.administracion_id IS NOT NULL THEN
    v_to_email := public.admin_login_email(v_tramite.administracion_id);
  END IF;
  v_to_email := COALESCE(NULLIF(v_to_email,''), NULLIF(v_tramite.solicitante_email,''));
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  v_portal_url := 'https://www.gestionglobal.ar/portal/gestiones/' || v_linea.tramite_id::text;
  IF v_to_email IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_email('tracking-avance-cliente', v_to_email, v_to_nombre,
        jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_svc, 'descripcion', v_linea.descripcion, 'portal_url', v_portal_url),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', v_linea.id, 3::smallint);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_admin_user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_svc, substring(v_linea.descripcion, 1, 140), NULL, v_portal_url);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance', 'Nuevo avance: ' || v_svc,
        substring(v_linea.descripcion, 1, 200), '/portal/gestiones/' || v_linea.tramite_id::text,
        jsonb_build_object('tramite_id', v_linea.tramite_id, 'linea_id', v_linea.id, 'servicio', v_svc));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$function$;

-- (#3 ALTO) tramite_avisar_cancelacion: "Tu trámite fue cancelado".
CREATE OR REPLACE FUNCTION public.tramite_avisar_cancelacion(p_tramite_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text; v_nombre text; v_codigo text; v_admin uuid; v_qid uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  SELECT solicitante_email, solicitante_nombre, codigo, administracion_id
    INTO v_email, v_nombre, v_codigo, v_admin
    FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe' USING ERRCODE='P0002'; END IF;
  -- email de login del admin → fallback solicitante_email (JL 1/5).
  v_email := COALESCE(NULLIF(btrim(public.admin_login_email(v_admin)),''), NULLIF(btrim(v_email),''));
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'El trámite no tiene email del solicitante' USING ERRCODE='22023';
  END IF;

  v_qid := public.encolar_email(
    p_template := 'tramite-cancelado',
    p_to_email := btrim(v_email),
    p_to_nombre := COALESCE(NULLIF(btrim(v_nombre),''), 'Hola'),
    p_variables := jsonb_build_object('nombre', COALESCE(NULLIF(btrim(v_nombre),''), ''),
                                      'numero', COALESCE(v_codigo, '')),
    p_administracion_id := v_admin,
    p_consorcio_id := NULL,
    p_related_table := 'tramites',
    p_related_id := p_tramite_id,
    p_prioridad := 3::smallint
  );
  RETURN jsonb_build_object('ok', true, 'queue_id', v_qid, 'email', btrim(v_email));
END;
$function$;

-- (#4 ALTO) tracking_reabrir: "Tu trámite fue reabierto" — usaba administraciones.email.
CREATE OR REPLACE FUNCTION public.tracking_reabrir(p_tramite_id uuid, p_motivo text, p_notificar_cliente boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite     record;
  v_admin       record;
  v_email_to    text;
  v_email_name  text;
  v_motivo_clean text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo_staff_puede_reabrir' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tramite_inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF v_tramite.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'tramite_no_cerrado_no_se_reabre' USING ERRCODE = '22023';
  END IF;

  v_motivo_clean := COALESCE(trim(p_motivo), '');
  IF length(v_motivo_clean) = 0 THEN
    RAISE EXCEPTION 'motivo_reapertura_requerido' USING ERRCODE = '23502';
  END IF;

  UPDATE public.tramites
    SET estado                  = 'en_progreso',
        fecha_fin               = NULL,
        motivo_cierre           = NULL,
        cierre_satisfactorio    = NULL,
        resuelto_at             = NULL,
        resuelto_por            = NULL,
        reabierto_count         = reabierto_count + 1,
        ultima_reapertura_at    = now(),
        ultima_reapertura_motivo= v_motivo_clean,
        ultima_actividad_at     = now()
   WHERE id = p_tramite_id;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id, 'reapertura',
    'Trámite reabierto. Motivo: ' || v_motivo_clean,
    'reabierto', '{}'::text[], auth.uid(), true
  );

  IF p_notificar_cliente THEN
    SELECT a.* INTO v_admin FROM public.administraciones a
      WHERE a.id = v_tramite.administracion_id;

    IF v_admin.id IS NOT NULL THEN
      -- email de login del admin → fallback administraciones.email (JL 1/5).
      v_email_to := COALESCE(NULLIF(btrim(public.admin_login_email(v_admin.id)),''), v_admin.email);
      v_email_name := v_admin.nombre;

      IF v_email_to IS NOT NULL AND length(trim(v_email_to)) > 0 THEN
        BEGIN
          PERFORM public.encolar_email(
            'tramite-reabierto', v_email_to, v_email_name,
            jsonb_build_object(
              'cliente_nombre',    v_email_name,
              'tramite_codigo',    v_tramite.codigo,
              'tramite_titulo',    v_tramite.titulo,
              'tramite_id',        v_tramite.id::text,
              'motivo_reapertura', v_motivo_clean
            ),
            v_admin.id, NULL, 'tramites', v_tramite.id, 1::smallint
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;

      IF v_admin.user_id IS NOT NULL THEN
        BEGIN
          PERFORM public.encolar_push(
            v_admin.user_id, 'Reabrimos tu gestión',
            v_tramite.titulo || ' · Motivo: ' || left(v_motivo_clean, 120),
            NULL, '/portal/gestiones/' || v_tramite.id::text
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;
  END IF;
END;
$function$;

-- (#5 MEDIO) tracking_linea_on_insert — rama recordatorio (tracking-recordatorio).
-- La rama de avance visible delega en tracking_notificar_avance_cliente (#2, ya
-- corregido); acá sólo se corrige la resolución del email del recordatorio.
CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  -- email de login del admin → solicitante_email → administraciones.email (JL 1/5).
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_tramite.administracion_id IS NOT NULL THEN
    v_to_email := public.admin_login_email(v_tramite.administracion_id);
  END IF;
  v_to_email := COALESCE(NULLIF(v_to_email,''), NULLIF(v_tramite.solicitante_email,''));
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL THEN
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
