-- ============================================================================
-- 0263_hardening_guard_null_rpcs_secdef.sql
-- E-GG-75 sweep · Endurecimiento defensivo del patrón `v_role NOT IN (...)`:
-- con auth.uid() NULL, v_role queda NULL y `NULL NOT IN (...)` → NULL → el IF no
-- dispara → bypass del guard. HOY no explotable (estas funciones NO son
-- anon-ejecutables, ACL sólo authenticated), pero el guard no debe depender sólo
-- del ACL. Fix uniforme (espeja mig 0261): `IF auth.uid() IS NULL THEN RAISE` +
-- `COALESCE(v_role,'')` en el chequeo. Cuerpos idénticos salvo esos 2 cambios.
-- Alcance (barrido completo de SECURITY DEFINER con el patrón): 5 RPCs de pedidos
-- de doc + actualizar_gerente (gestión de roles, sensible) + restaurar_formulario_version.
-- ============================================================================

-- 1) subir item
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_subir_item(p_item_id uuid, p_archivo_path text, p_archivo_nombre text, p_archivo_mime text, p_archivo_size bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_item public.tramite_pedidos_doc_items%ROWTYPE;
  v_pedido public.tramite_pedidos_doc%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_admin_ok boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  SELECT * INTO v_item FROM public.tramite_pedidos_doc_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;
  SELECT * INTO v_pedido FROM public.tramite_pedidos_doc WHERE id = v_item.pedido_id;
  IF v_pedido.estado <> 'abierto' THEN RAISE EXCEPTION 'El pedido ya no está abierto (estado: %)', v_pedido.estado; END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = v_pedido.tramite_id;
  v_admin_ok := EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND role = 'administrador' AND administracion_id = v_tramite.administracion_id);
  IF NOT v_admin_ok AND COALESCE(v_role,'') <> 'gerente' THEN RAISE EXCEPTION 'No autorizado para subir este item'; END IF;
  UPDATE public.tramite_pedidos_doc_items
     SET archivo_path=p_archivo_path, archivo_nombre=p_archivo_nombre,
         archivo_mime=p_archivo_mime, archivo_size_bytes=p_archivo_size,
         subido_at=now(), subido_por=v_user_id, estado='subido',
         revisado_at=NULL, revisado_por=NULL, observaciones_rev=NULL
   WHERE id = p_item_id;
END;
$function$;

-- 2) crear pedido
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_crear(p_tramite_id uuid, p_descripcion text, p_items text[])
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_pedido_id uuid;
  v_item text;
  v_idx int := 0;
  v_tramite public.tramites%ROWTYPE;
  v_cli_user uuid;
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

  SELECT id INTO v_cli_user
    FROM public.profiles
   WHERE administracion_id = v_tramite.administracion_id
     AND role = 'administrador' AND activo = true
   LIMIT 1;

  IF v_cli_user IS NOT NULL THEN
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

  IF v_tramite.solicitante_email IS NOT NULL AND v_tramite.solicitante_email <> '' THEN
    INSERT INTO public.email_queue (
      to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para)
    VALUES (
      v_tramite.solicitante_email, v_tramite.solicitante_nombre,
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

-- 3) aprobar item
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_aprobar_item(p_item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_item public.tramite_pedidos_doc_items%ROWTYPE;
  v_pendientes int; v_pedido_id uuid; v_tramite_id uuid;
  v_solici record; v_cli_user uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF COALESCE(v_role,'') <> 'gerente' THEN
    RAISE EXCEPTION 'Solo gerencia puede aprobar items';
  END IF;
  SELECT * INTO v_item FROM public.tramite_pedidos_doc_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;
  IF v_item.estado NOT IN ('subido','rechazado') THEN
    RAISE EXCEPTION 'Solo se aprueban items subidos (estado actual: %)', v_item.estado;
  END IF;
  UPDATE public.tramite_pedidos_doc_items
     SET estado='aprobado', revisado_at=now(), revisado_por=v_user_id, observaciones_rev=NULL
   WHERE id = p_item_id;
  v_pedido_id := v_item.pedido_id;
  SELECT count(*) INTO v_pendientes FROM public.tramite_pedidos_doc_items
   WHERE pedido_id = v_pedido_id AND estado <> 'aprobado';
  IF v_pendientes = 0 THEN
    UPDATE public.tramite_pedidos_doc
       SET estado='completo', cerrado_at=now(), cerrado_por=v_user_id
     WHERE id = v_pedido_id RETURNING tramite_id INTO v_tramite_id;
    SELECT t.id, t.codigo, t.titulo, t.administracion_id, t.solicitante_email, t.solicitante_nombre
      INTO v_solici FROM public.tramites t WHERE t.id = v_tramite_id;
    SELECT id INTO v_cli_user FROM public.profiles
     WHERE administracion_id = v_solici.administracion_id
       AND role = 'administrador' AND activo = true LIMIT 1;
    IF v_cli_user IS NOT NULL THEN
      INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
      VALUES (v_cli_user, 'tramite_docs_aprobadas', 'Documentación aprobada',
              'Trámite ' || coalesce(v_solici.codigo, v_solici.titulo) || ': ya podemos continuar.',
              '/portal/gestiones/' || v_solici.id::text,
              jsonb_build_object('tramite_id', v_solici.id, 'pedido_id', v_pedido_id));
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (v_cli_user, 'Documentación aprobada',
              'Trámite ' || coalesce(v_solici.codigo, v_solici.titulo) || ' — continúa el proceso',
              '/portal/gestiones/' || v_solici.id::text);
    END IF;
    INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
      autor_id, visible_cliente, created_at)
    VALUES (v_tramite_id, 'aprobado',
      'Documentación aprobada · Toda la documentación requerida fue verificada y aprobada.',
      '{}'::text[], v_user_id, true, now());
  END IF;
END;
$function$;

-- 4) rechazar item
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_rechazar_item(p_item_id uuid, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  UPDATE public.tramite_pedidos_doc_items
     SET estado            = 'rechazado',
         revisado_at       = now(),
         revisado_por      = v_user_id,
         observaciones_rev = btrim(p_motivo)
   WHERE id = p_item_id;

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

-- 5) enviar a revisión
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_enviar_revision(p_pedido_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_pedido public.tramite_pedidos_doc%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_admin_ok boolean;
  v_items_sin_subir int; v_items_subidos int; v_ger_user uuid;
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

  IF v_tramite.solicitante_email IS NOT NULL AND v_tramite.solicitante_email <> '' THEN
    INSERT INTO public.email_queue (to_email, to_nombre, subject, kind, template_slug, variables, prioridad, programado_para)
    VALUES (v_tramite.solicitante_email, v_tramite.solicitante_nombre,
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

-- 6) actualizar gerente (gestión de roles — sensible)
CREATE OR REPLACE FUNCTION public.actualizar_gerente(p_user_id uuid, p_full_name text, p_role text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_actor_role,'') NOT IN ('gerente', 'superadmin') THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('gerente', 'operador') THEN
    RAISE EXCEPTION 'Rol inválido: %', p_role USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
    SET full_name = trim(p_full_name),
        role      = p_role
   WHERE id = p_user_id
     AND role IN ('gerente', 'operador');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o no editable' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_user_id;
END;
$function$;

-- 7) restaurar versión de formulario
CREATE OR REPLACE FUNCTION public.restaurar_formulario_version(p_formulario_id uuid, p_version_num integer)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_schema jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('gerente','operador') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT schema INTO v_schema
  FROM public.formulario_versiones
  WHERE formulario_id = p_formulario_id AND version_num = p_version_num;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Versión no encontrada';
  END IF;

  UPDATE public.formularios
    SET schema = v_schema
    WHERE id = p_formulario_id;

  RETURN p_formulario_id;
END
$function$;
