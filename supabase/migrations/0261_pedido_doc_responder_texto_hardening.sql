-- ============================================================================
-- 0261_pedido_doc_responder_texto_hardening.sql
-- DGG-89 §6 · El e2e detectó que tramite_pedido_doc_responder_texto_item (mig 0260)
-- (a) quedó con EXECUTE para PUBLIC/anon (default de CREATE FUNCTION), a diferencia
--     de sus hermanas (subir/crear/aprobar/rechazar = sólo authenticated), y
-- (b) heredó el patrón `v_role NOT IN ('gerente')` que con auth.uid() NULL evalúa
--     NULL → el IF no dispara → bypass del guard.
-- Combinados: un anon con un item_id válido podía escribir respuesta_texto.
-- Fix: REVOKE anon/PUBLIC + GRANT authenticated (cierra el acceso) + guard robusto
-- (rechaza si no hay auth; COALESCE en el chequeo de rol).
-- (Las hermanas comparten el patrón NULL pero NO son anon-ejecutables → latente,
--  no explotable; anotado en ERRORES para un sweep aparte.)
-- ============================================================================
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
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
  IF NOT v_admin_ok AND COALESCE(v_role,'') <> 'gerente' THEN
    RAISE EXCEPTION 'No autorizado para responder este item';
  END IF;
  UPDATE public.tramite_pedidos_doc_items
     SET respuesta_texto = btrim(p_texto),
         subido_at = now(), subido_por = v_user_id, estado = 'subido',
         revisado_at = NULL, revisado_por = NULL, observaciones_rev = NULL
   WHERE id = p_item_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tramite_pedido_doc_responder_texto_item(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_pedido_doc_responder_texto_item(uuid, text) TO authenticated;
