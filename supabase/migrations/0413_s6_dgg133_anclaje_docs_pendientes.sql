-- ============================================================================
-- 0413 · §6 DGG-133 — Anclaje de 'tramite-docs-pendientes' en email_queue
--
-- Hallazgo §6 (refutado a menor, pero se cierra igual — "sin huecos"):
-- tramite_pedido_doc_crear (mig 0309) encolaba el mail SIN related_table /
-- related_id, por lo que el "ojito" de DGG-133 (getUltimoEnvioClienteId, que
-- ancla por related_table IN ('tramites','tracking_lineas')) jamás podía
-- devolver ese template — quedaba como entrada muerta en TEMPLATES_CLIENTE.
-- Mitigación pre-existente: la misma RPC crea la línea visible cuyo trigger
-- encola un tracking-avance-cliente gemelo SÍ anclado (8/8 casos reales).
-- Igual se ancla la fuente para que el preview muestre el mail REAL del
-- pedido (subject + items) y no el gemelo genérico.
--
-- Regla 16: misma firma (uuid, text, text[]) → CREATE OR REPLACE no crea
-- overload. Regla 18: smoke e2e al pie.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_crear(
  p_tramite_id uuid, p_descripcion text, p_items text[]
) RETURNS uuid
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
              left(coalesce(NULLIF(btrim(p_descripcion),''),'Documentación requerida'), 120),
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
        'descripcion', btrim(p_descripcion), 'items_count', v_idx,
        'portal_url', '/portal/gestiones/' || v_tramite.id::text),
      2, now(), 'tramites', v_tramite.id);
  END IF;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente, created_at)
  VALUES (p_tramite_id, 'documentacion_incompleta',
    'Pedido de documentación: ' || coalesce(NULLIF(btrim(p_descripcion),''),'Documentación requerida'),
    '{}'::text[], v_user_id, true, now());

  RETURN v_pedido_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.tramite_pedido_doc_crear(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_pedido_doc_crear(uuid, text, text[]) TO authenticated, service_role;

-- Backfill de las filas históricas sin anclaje: match determinístico por
-- variables->>'tramite_codigo' (la RPC siempre lo grabó) — no se parsea subject.
UPDATE public.email_queue eq
SET related_table = 'tramites', related_id = t.id
FROM public.tramites t
WHERE eq.template_slug = 'tramite-docs-pendientes'
  AND eq.related_table IS NULL
  AND eq.variables->>'tramite_codigo' IS NOT NULL
  AND t.codigo = eq.variables->>'tramite_codigo';
