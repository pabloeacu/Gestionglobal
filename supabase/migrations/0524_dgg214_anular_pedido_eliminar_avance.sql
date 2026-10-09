-- 0524_dgg214_anular_pedido_eliminar_avance.sql
-- DGG-214 (relevamiento JL, pestaña "PARA VER", items 2 y 3):
--   (2) "Se cargaron 2 Pedidos de Documentación al cliente … Deberíamos poder
--        Anular uno de los Pedidos."
--   (3) "Deberíamos poder editar o eliminar cualquier avance del tracking."
--
-- CONTEXTO (de la auditoría §6):
--   - tramite_pedidos_doc.estado ya admite 'cancelado' (CHECK abierto|completo|
--     cancelado) y la UI ya pinta el badge "Cancelado", pero NO había RPC ni
--     botón para que gerencia lo anulara a mano.
--   - Al crear un pedido, tramite_pedido_doc_crear inserta ADEMÁS una
--     tracking_lineas VISIBLE ("Pedido de documentación: …") que el cliente ve
--     en su timeline. No había vínculo con el pedido → si sólo cambiáramos el
--     estado, el cliente seguiría viendo el pedido duplicado. Por eso agregamos
--     tracking_lineas.pedido_id y, al anular, ocultamos esa línea.
--   - "Editar avance" YA existe (gerente_editar_avance_tracking, sólo texto).
--     "Eliminar avance" no existía → nueva RPC.
--
-- Reglas: R6 (migración + GRANT), R11 (índice en la FK nueva), R12/tenancy n/a
-- (staff-only, is_staff), R16 (CREATE OR REPLACE del crear NO cambia la firma →
-- sin overload), R17 (las RPCs nuevas son SECURITY DEFINER; no insertan en
-- tablas RLS sin write-policy — tracking_lineas tiene tl_staff_all, pedidos
-- tiene pedidos_doc_gerente_all), R18 (smoke e2e aparte).

-- =====================================================================
-- 1) Vínculo línea-de-timeline ↔ pedido (resuelve el "pedido duplicado")
-- =====================================================================
ALTER TABLE public.tracking_lineas
  ADD COLUMN IF NOT EXISTS pedido_id uuid NULL
  REFERENCES public.tramite_pedidos_doc(id) ON DELETE SET NULL;

-- R11: toda FK con su índice (Postgres no lo crea solo).
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_pedido_id
  ON public.tracking_lineas(pedido_id);

-- Backfill: la línea "Pedido de documentación: …" y su pedido se crean en la
-- MISMA transacción, así que comparten el now() exacto (created_at = creado_at)
-- dentro del mismo trámite. Vinculamos por esa igualdad (no por texto, frágil).
UPDATE public.tracking_lineas tl
SET pedido_id = p.id
FROM public.tramite_pedidos_doc p
WHERE tl.pedido_id IS NULL
  AND tl.categoria = 'documentacion_incompleta'
  AND p.tramite_id = tl.tramite_id
  AND p.creado_at = tl.created_at;

-- =====================================================================
-- 2) crear: setear pedido_id en la línea visible (verbatim + 1 cambio)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_crear(
  p_tramite_id uuid, p_descripcion text, p_items text[], p_archivos_urls text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
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

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente, created_at, pedido_id)
  VALUES (p_tramite_id, 'documentacion_incompleta',
    'Pedido de documentación: ' || v_desc_notif,
    COALESCE(p_archivos_urls, '{}'::text[]), v_user_id, true, now(), v_pedido_id);

  RETURN v_pedido_id;
END;
$fn$;

-- =====================================================================
-- 3) Anular un pedido de documentación (staff-only)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_cancelar(p_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede anular pedidos de documentación';
  END IF;

  -- Sólo se anulan pedidos abiertos. Idempotencia defensiva vía NOT FOUND.
  UPDATE public.tramite_pedidos_doc
     SET estado = 'cancelado', cerrado_at = now(), cerrado_por = auth.uid()
   WHERE id = p_pedido_id AND estado = 'abierto';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe o no está abierto (no se puede anular)';
  END IF;

  -- Ocultar del timeline del cliente la línea visible de ese pedido, para que
  -- el pedido anulado deje de verse (resuelve el "pedido duplicado" de JL).
  -- El trigger sync_tramite_requiere_docs recalcula requiere_docs_cliente solo.
  UPDATE public.tracking_lineas
     SET visible_cliente = false
   WHERE pedido_id = p_pedido_id AND visible_cliente = true;
END;
$fn$;

-- =====================================================================
-- 4) Eliminar cualquier avance del tracking (staff-only, hard delete)
-- =====================================================================
-- Nota: el DELETE limpia el avance del historial; NO revierte efectos ya
-- aplicados en el momento del alta (cambios de estado, emails/push encolados,
-- otorgamientos escritos en la ficha). La UI lo aclara en el confirm.
CREATE OR REPLACE FUNCTION public.gerente_eliminar_avance_tracking(p_linea_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede eliminar avances del tracking';
  END IF;

  DELETE FROM public.tracking_lineas WHERE id = p_linea_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El avance no existe';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.tramite_pedido_doc_cancelar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerente_eliminar_avance_tracking(uuid) TO authenticated;
