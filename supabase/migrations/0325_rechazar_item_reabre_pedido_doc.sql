-- 0325 · #5 (reporte JL): docs en tandas / re-subida tras rechazo queda muda.
--
-- Bug: `tramite_pedido_doc_rechazar_item` marcaba el item 'rechazado' y avisaba
-- al cliente, pero NO limpiaba `tramite_pedidos_doc.enviado_para_revision_at`.
-- El botón "Enviar a gerencia" del portal depende de `enviado_para_revision_at
-- IS NULL` (PedidosDocPanel). Con el flag seteado, tras corregir y re-subir el
-- item, el cliente NO podía re-enviar → gerencia nunca se re-enteraba.
--
-- Fix: al rechazar un item, reabrir el pedido (enviado_para_revision_at = NULL),
-- restaurando el ciclo subir→enviar→avisar. Alinea con la intención de la mig
-- 0130 (e). Misma firma → CREATE OR REPLACE no genera overload (R16 OK).
-- La fn ya es SECURITY DEFINER (escribe en tablas RLS solo-SELECT) → R17 OK.

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

  UPDATE public.tramite_pedidos_doc_items
     SET estado            = 'rechazado',
         revisado_at       = now(),
         revisado_por      = v_user_id,
         observaciones_rev = btrim(p_motivo)
   WHERE id = p_item_id;

  -- E-GG-107 (#5): reabrir el pedido para que el cliente pueda re-subir Y
  -- re-enviar a revisión (el botón "Enviar a gerencia" exige enviado_para_
  -- revision_at IS NULL). Sin esto, el aviso a gerencia tras la corrección
  -- quedaba mudo.
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
