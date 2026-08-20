-- ============================================================================
-- 0431_jlr3_pedido_doc_aviso_no_vacio.sql
-- JL-R3 (cierre §6, hallazgo #2 del audit) · regresión colateral del fix R3.
--
-- El fix R3 (ModeracionPage + AgregarLineaDrawer) pasa p_descripcion='' a
-- tramite_pedido_doc_crear para NO duplicar el texto en el portal (header del
-- pedido == único ítem). Efecto lateral: la RPC arma el MAIL
-- ('tramite-docs-pendientes' · variable {{descripcion}}), la CAMPANITA
-- (notificaciones_internas.cuerpo) y la LÍNEA DE TRACKING visible al cliente
-- desde p_descripcion crudo → con '' el aviso queda vacío/genérico y el cliente
-- no ve QUÉ se le pide en el correo (sólo "N documento(s) pendiente(s)").
--
-- Fix: para esas TRES superficies de aviso usar un fallback a los ítems
-- (v_desc_notif) cuando la descripción viene vacía. El HEADER del pedido
-- (tramite_pedidos_doc.descripcion) queda en su default 'Documentación
-- requerida' → NO se reintroduce la duplicación del portal. Los llamadores con
-- descripción real (CrearPedidoModal, multi-ítem) no cambian: v_desc_notif=desc.
--
-- R18: smoke e2e al pie (BEGIN/ROLLBACK en execute_sql aparte).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_crear(p_tramite_id uuid, p_descripcion text, p_items text[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
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
  v_cli_email text;
  v_to_email text;
  v_desc_notif text;  -- JL-R3 §6: texto para MAIL/CAMPANITA/LÍNEA (fallback a ítems)
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede crear pedidos de documentación';
  END IF;
  IF p_items IS NULL OR array_length(p_items, 1) IS NULL THEN
    RAISE EXCEPTION 'Debe incluir al menos un item';
  END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite % no existe', p_tramite_id; END IF;

  -- Texto informativo para los avisos: descripción si viene, si no los ítems
  -- (evita que el mail/campanita queden vacíos cuando el header va vacío para
  -- no duplicar en el portal — JL-R3).
  v_desc_notif := COALESCE(
    NULLIF(btrim(p_descripcion), ''),
    NULLIF(array_to_string(ARRAY(SELECT btrim(x) FROM unnest(p_items) x WHERE btrim(x) <> ''), ' · '), ''),
    'Documentación requerida');

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
    SELECT email INTO v_cli_email FROM auth.users WHERE id = v_cli_user;
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_cli_user, 'tramite_docs_pendientes',
            'Necesitamos documentación adicional',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ': ' ||
              left(v_desc_notif, 120),
            '/portal/gestiones/' || v_tramite.id::text,
            jsonb_build_object('tramite_id', v_tramite.id, 'pedido_id', v_pedido_id, 'items_count', v_idx));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_cli_user, 'Necesitamos documentación',
            'Trámite ' || coalesce(v_tramite.codigo, v_tramite.titulo) || ' — revisá tu portal',
            '/portal/gestiones/' || v_tramite.id::text);
  END IF;

  v_to_email := COALESCE(NULLIF(btrim(v_cli_email), ''), NULLIF(btrim(v_tramite.solicitante_email), ''));
  IF v_to_email IS NOT NULL THEN
    -- 0413: + related_table/related_id — el ojito de DGG-133 ancla por acá.
    INSERT INTO public.email_queue (
      to_email, to_nombre, subject, kind, template_slug, variables, prioridad,
      programado_para, related_table, related_id)
    VALUES (
      v_to_email, v_tramite.solicitante_nombre,
      'Necesitamos documentación adicional — Trámite ' || coalesce(v_tramite.codigo, ''),
      'workflow', 'tramite-docs-pendientes',
      jsonb_build_object('nombre', v_tramite.solicitante_nombre,
        'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
        'descripcion', v_desc_notif, 'items_count', v_idx,
        'portal_url', '/portal/gestiones/' || v_tramite.id::text),
      2, now(), 'tramites', v_tramite.id);
  END IF;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente, created_at)
  VALUES (p_tramite_id, 'documentacion_incompleta',
    'Pedido de documentación: ' || v_desc_notif,
    '{}'::text[], v_user_id, true, now());

  RETURN v_pedido_id;
END;
$function$;

-- R16: sin overloads
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='tramite_pedido_doc_crear';
  IF v_n <> 1 THEN RAISE EXCEPTION 'JL-R3: overload de tramite_pedido_doc_crear (R16): %', v_n; END IF;
END $$;
