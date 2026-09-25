-- 0515 · Fix A3 (reporte JL 23/9/2026): los adjuntos de gestoría NO llegan al cliente en pedidos de doc.
--
-- CAUSA RAÍZ (confirmada con datos: 35 líneas 'documentacion_incompleta' visibles, 0 con adjuntos;
-- 35 'gestor_avance' visibles, 32 con adjuntos): cuando gerencia convierte un aporte de gestoría en un
-- "Pedido de documentación" (Moderación → onConvertirEnPedido), la RPC tramite_pedido_doc_crear inserta
-- la línea visible al cliente (categoria 'documentacion_incompleta') con archivos_urls HARDCODEADO a '{}'
-- y su firma ni siquiera aceptaba adjuntos. Además Moderación marca la línea original del gestor (la que
-- SÍ tiene los adjuntos) como 'interno' (visible_cliente=false) → los archivos quedan huérfanos. Por eso
-- el cliente ve "Documentación solicitada: ..." sin nada para bajar. El camino "informativo" (publicar el
-- gestor_avance) conserva archivos_urls y por eso ahí SÍ llegan.
--
-- FIX (aditivo): la RPC acepta p_archivos_urls text[] DEFAULT '{}' y lo usa en la línea visible. El cliente
-- ya los descarga con el TimelineItem existente (mismo bucket privado gestor-uploads, firmado on-click).
-- R16: agregar un parámetro a una RPC pública NO se hace con CREATE OR REPLACE (crea overload ambiguo que
-- rompe PostgREST) → DROP + CREATE. R11/GRANTs: re-otorgar EXECUTE a authenticated + service_role (anon no).
-- Backward-compatible: los callers que no pasan adjuntos usan el DEFAULT '{}' (comportamiento actual).

DROP FUNCTION IF EXISTS public.tramite_pedido_doc_crear(uuid, text, text[]);

CREATE FUNCTION public.tramite_pedido_doc_crear(
  p_tramite_id uuid,
  p_descripcion text,
  p_items text[],
  p_archivos_urls text[] DEFAULT '{}'::text[]
)
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
  v_cli_email text;
  v_to_email text;
  v_desc_notif text;
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

  -- Línea visible al cliente: ahora conserva los adjuntos que gestoría/gerencia envían para el cliente
  -- (antes '{}'::text[] fijo → el cliente no tenía nada para bajar en un pedido de documentación).
  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente, created_at)
  VALUES (p_tramite_id, 'documentacion_incompleta',
    'Pedido de documentación: ' || v_desc_notif,
    COALESCE(p_archivos_urls, '{}'::text[]), v_user_id, true, now());

  RETURN v_pedido_id;
END;
$function$;

-- R11/GRANTs (least-privilege, replica el acl previo: authenticated + service_role, anon NO).
-- OJO: los DEFAULT PRIVILEGES de Supabase auto-otorgan EXECUTE a anon en toda función nueva → hay que
-- revocar anon explícito (REVOKE FROM PUBLIC no lo saca porque es un grant directo al rol anon).
REVOKE EXECUTE ON FUNCTION public.tramite_pedido_doc_crear(uuid, text, text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tramite_pedido_doc_crear(uuid, text, text[], text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.tramite_pedido_doc_crear(uuid, text, text[], text[]) TO authenticated, service_role;