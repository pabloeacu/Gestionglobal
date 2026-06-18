-- ============================================================================
-- 0260_pedido_doc_responder_texto.sql
-- DGG-89 (reporte JL #2) · El pedido de documentación era archivo-only: si la
-- gerencia pedía un DATO (ej. "número de legajo"), el cliente sólo podía subir un
-- archivo y quedaba trabado. Decisión de Pablo: CUALQUIER ítem se puede responder
-- con TEXTO o con ARCHIVO (gerencia revisa y aprueba/rechaza igual). Aditivo:
--  - columna respuesta_texto en los ítems.
--  - RPC nueva para responder con texto (espeja tramite_pedido_doc_subir_item:
--    pedido abierto + admin del trámite o gerente; deja estado='subido').
-- ============================================================================
ALTER TABLE public.tramite_pedidos_doc_items
  ADD COLUMN IF NOT EXISTS respuesta_texto text;

CREATE OR REPLACE FUNCTION public.tramite_pedido_doc_responder_texto_item(p_item_id uuid, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_role text;
  v_item public.tramite_pedidos_doc_items%ROWTYPE;
  v_pedido public.tramite_pedidos_doc%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_admin_ok boolean;
BEGIN
  IF coalesce(btrim(p_texto),'') = '' THEN
    RAISE EXCEPTION 'La respuesta no puede estar vacía';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  SELECT * INTO v_item FROM public.tramite_pedidos_doc_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;
  SELECT * INTO v_pedido FROM public.tramite_pedidos_doc WHERE id = v_item.pedido_id;
  IF v_pedido.estado <> 'abierto' THEN
    RAISE EXCEPTION 'El pedido ya no está abierto (estado: %)', v_pedido.estado;
  END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = v_pedido.tramite_id;
  v_admin_ok := EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_user_id AND role = 'administrador'
       AND administracion_id = v_tramite.administracion_id
  );
  IF NOT v_admin_ok AND v_role NOT IN ('gerente') THEN
    RAISE EXCEPTION 'No autorizado para responder este item';
  END IF;
  UPDATE public.tramite_pedidos_doc_items
     SET respuesta_texto = btrim(p_texto),
         subido_at = now(), subido_por = v_user_id, estado = 'subido',
         revisado_at = NULL, revisado_por = NULL, observaciones_rev = NULL
   WHERE id = p_item_id;
END;
$function$;
