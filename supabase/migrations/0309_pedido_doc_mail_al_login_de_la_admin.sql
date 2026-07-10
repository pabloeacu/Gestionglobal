-- 0309 · Reporte JL (puntos 1 y 5) · el mail de "pedido de documentación" iba al
-- `solicitante_email` del trámite (texto libre, capturado en el alta/derivación),
-- que puede diferir del email de LOGIN de la administración dueña del trámite.
-- Caso real: TRM-2026-00071 vive bajo la admin de login `luciafotos4`, pero el
-- solicitante_email quedó `luciafotos` (otra cuenta de la misma persona) → Lucía
-- recibe el mail en `luciafotos`, entra con esa sesión, y esa sesión NO ve el
-- trámite (filtra por current_administracion_id) → "No encontramos este trámite" y
-- no puede subir la documentación. La notif interna y el push YA se resuelven bien
-- (por administracion_id → v_cli_user). Sólo el mail estaba desacoplado.
--
-- Fix: el mail se dirige al email de LOGIN real de la administración dueña
-- (auth.users del administrador activo de esa admin); fallback a solicitante_email
-- si la admin no tiene portal. Misma firma → CREATE OR REPLACE (R16).
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_crear(p_tramite_id uuid, p_descripcion text, p_items text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_pedido_id uuid;
  v_item text;
  v_idx int := 0;
  v_tramite public.tramites%ROWTYPE;
  v_cli_user uuid;
  v_cli_email text;   -- 0309: email de LOGIN de la admin dueña del trámite
  v_to_email text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF COALESCE(v_role,'') <> 'gerente' THEN
    RAISE EXCEPTION 'Solo gerencia puede crear pedidos de documentación';
  END IF;
  IF p_items IS NULL OR array_length(p_items, 1) IS NULL THEN
    RAISE EXCEPTION 'Debe incluir al menos un item';
  END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite % no existe', p_tramite_id; END IF;

  INSERT INTO public.tramite_pedidos_doc (tramite_id, descripcion, creado_por)
    VALUES (p_tramite_id, COALESCE(NULLIF(btrim(p_descripcion),''),'Documentación requerida'), v_user_id)
    RETURNING id INTO v_pedido_id;

  FOREACH v_item IN ARRAY p_items LOOP
    IF coalesce(btrim(v_item),'') = '' THEN CONTINUE; END IF;
    INSERT INTO public.tramite_pedidos_doc_items (pedido_id, descripcion, orden)
      VALUES (v_pedido_id, btrim(v_item), v_idx);
    v_idx := v_idx + 1;
  END LOOP;

  -- Administrador (login) dueño del trámite → notif/push/email todos a ESTE.
  SELECT id INTO v_cli_user
    FROM public.profiles
   WHERE administracion_id = v_tramite.administracion_id
     AND role = 'administrador' AND activo = true
   LIMIT 1;

  IF v_cli_user IS NOT NULL THEN
    SELECT email INTO v_cli_email FROM auth.users WHERE id = v_cli_user;
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'tramite_docs_pendientes',
            'Necesitamos documentación adicional',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ': ' ||
              left(coalesce(NULLIF(btrim(p_descripcion),''),'Documentación requerida'), 120),
            '/portal/gestiones/' || v_tramite.id::text,
            jsonb_build_object('tramite_id', v_tramite.id, 'pedido_id', v_pedido_id, 'items_count', v_idx));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_cli_user, 'Necesitamos documentación',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ' — revisá tu portal',
            '/portal/gestiones/' || v_tramite.id::text);
  END IF;

  -- El mail va al LOGIN de la admin (v_cli_email); fallback a solicitante_email.
  v_to_email := COALESCE(NULLIF(btrim(v_cli_email), ''), NULLIF(btrim(v_tramite.solicitante_email), ''));
  IF v_to_email IS NOT NULL THEN
    INSERT INTO public.email_queue (
      to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para)
    VALUES (
      v_to_email, v_tramite.solicitante_nombre,
      'Necesitamos documentación adicional — Trámite ' || coalesce(v_tramite.codigo, ''),
      'workflow', 'tramite-docs-pendientes',
      jsonb_build_object('nombre', v_tramite.solicitante_nombre,
        'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
        'descripcion', btrim(p_descripcion), 'items_count', v_idx,
        'portal_url', '/portal/gestiones/' || v_tramite.id::text),
      2, now());
  END IF;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente, created_at)
  VALUES (p_tramite_id, 'documentacion_incompleta',
    'Pedido de documentación: ' || coalesce(NULLIF(btrim(p_descripcion),''),'Documentación requerida'),
    '{}'::text[], v_user_id, true, now());

  RETURN v_pedido_id;
END;
$function$;
