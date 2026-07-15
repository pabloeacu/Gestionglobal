-- 0354 · wave 7 · E-GG-137
-- Endurecer el loop de corrección de observaciones del Pedido de Documentación.
-- Dos huecos hallados en la QA (mapeo doble §6):
--   (1) tramite_pedido_doc_enviar_revision bloqueaba SÓLO ítems 'pendiente' →
--       tras un rechazo (E-GG-107 resetea enviado_para_revision_at=NULL) el cliente
--       podía RE-ENVIAR el lote con un ítem 'rechazado' sin corregir; gerencia
--       recibía "cliente envió documentación" con la observación viva. Ahora también
--       bloquea si hay ítems 'rechazado' (hay que re-subir lo observado → vuelve a 'subido').
--   (2) tramite_pedido_doc_rechazar_item NO validaba el estado de origen (aprobar_item
--       SÍ lo hace) → se podía "observar" un ítem 'pendiente' (que el cliente nunca subió,
--       notificándole una observación fantasma) o un 'aprobado' (des-aprobándolo en silencio
--       y dejando el pedido 'completo' con un ítem 'rechazado' → estado inconsistente).
--       Ahora sólo se observan ítems 'subido' o 'rechazado' (re-observar), nunca 'pendiente'/'aprobado'.
-- CREATE OR REPLACE, firmas idénticas → R16 sin DROP, GRANTs preservados.

CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_enviar_revision(p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_pedido public.tramite_pedidos_doc%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_admin_ok boolean;
  v_items_sin_subir int; v_items_rechazados int; v_items_subidos int; v_ger_user uuid;
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

  -- E-GG-137: no permitir reenviar con observaciones sin corregir.
  SELECT count(*) INTO v_items_rechazados FROM public.tramite_pedidos_doc_items
   WHERE pedido_id = p_pedido_id AND estado = 'rechazado';
  IF v_items_rechazados > 0 THEN
    RAISE EXCEPTION 'Tenés % ítem(s) observado(s) sin corregir. Volvé a subir lo observado antes de reenviar.', v_items_rechazados;
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

CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_rechazar_item(p_item_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_role     text;
  v_item     public.tramite_pedidos_doc_items%ROWTYPE;
  v_pedido   public.tramite_pedidos_doc%ROWTYPE;
  v_tramite  public.tramites%ROWTYPE;
  v_cli_user uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF COALESCE(v_role,'') <> 'gerente' THEN
    RAISE EXCEPTION 'Solo gerencia puede rechazar items';
  END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'Motivo de rechazo requerido';
  END IF;

  SELECT * INTO v_item FROM public.tramite_pedidos_doc_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;

  -- E-GG-137: sólo se observan ítems que el cliente subió (o re-observar uno ya observado).
  -- Bloquea 'pendiente' (observación fantasma de algo nunca enviado) y 'aprobado'
  -- (des-aprobación silenciosa que dejaría el pedido 'completo' con un ítem 'rechazado').
  IF v_item.estado NOT IN ('subido','rechazado') THEN
    RAISE EXCEPTION 'Solo se pueden observar ítems que el cliente subió (estado actual: %)', v_item.estado;
  END IF;

  UPDATE public.tramite_pedidos_doc_items
     SET estado            = 'rechazado',
         revisado_at       = now(),
         revisado_por      = v_user_id,
         observaciones_rev = btrim(p_motivo)
   WHERE id = p_item_id;

  UPDATE public.tramite_pedidos_doc
     SET enviado_para_revision_at = NULL
   WHERE id = v_item.pedido_id;

  SELECT * INTO v_pedido FROM public.tramite_pedidos_doc WHERE id = v_item.pedido_id;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = v_pedido.tramite_id;

  SELECT id INTO v_cli_user
    FROM public.profiles
   WHERE administracion_id = v_tramite.administracion_id
     AND role = 'administrador'
     AND activo = true
   LIMIT 1;

  IF v_cli_user IS NOT NULL THEN
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'tramite_doc_item_rechazado',
            'Documentación observada',
            v_item.descripcion || ': ' || btrim(p_motivo),
            '/portal/gestiones/' || v_tramite.id::text,
            jsonb_build_object('tramite_id', v_tramite.id, 'item_id', p_item_id, 'motivo', btrim(p_motivo)));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_cli_user, 'Documentación observada',
            left(v_item.descripcion || ': ' || btrim(p_motivo), 140),
            '/portal/gestiones/' || v_tramite.id::text);
  END IF;
END;
$function$;
