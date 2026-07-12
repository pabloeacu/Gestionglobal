-- 0327 · #4 (reporte JL): cuando el cliente envía documentación NO aparece en
-- el Inicio del panel (sí en campanita y en el trámite). El Inicio son widgets
-- sobre tablas de dominio; la gestoría tiene su widget (AportesGestoriaWidget,
-- E-GG-91) pero la doc del cliente no tenía ninguno.
--
-- Esta RPC alimenta un widget nuevo (DocsClientePendientesWidget), espejo del de
-- gestoría. Devuelve los pedidos de documentación ABIERTOS con ≥1 item SUBIDO
-- (= el cliente respondió y espera revisión). Se keyea por item 'subido' (no por
-- enviado_para_revision_at) para que también aparezca la subida PARCIAL / en
-- tandas (#5), sin depender de que el cliente apriete "Enviar a gerencia".
-- Staff-only (is_staff): un no-staff recibe 0 filas.

CREATE OR REPLACE FUNCTION public.docs_cliente_pendientes()
 RETURNS TABLE(
   pedido_id      uuid,
   tramite_id     uuid,
   tramite_codigo text,
   cliente_nombre text,
   descripcion    text,
   items_subidos  int,
   creado_at      timestamptz
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RETURN;  -- sin filas para no-staff
  END IF;

  RETURN QUERY
  SELECT p.id,
         t.id,
         t.codigo,
         a.nombre,
         p.descripcion,
         (SELECT count(*)::int
            FROM public.tramite_pedidos_doc_items i
           WHERE i.pedido_id = p.id AND i.estado = 'subido'),
         p.creado_at
  FROM public.tramite_pedidos_doc p
  JOIN public.tramites t          ON t.id = p.tramite_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE p.estado = 'abierto'
    AND EXISTS (
      SELECT 1 FROM public.tramite_pedidos_doc_items i
       WHERE i.pedido_id = p.id AND i.estado = 'subido'
    )
  ORDER BY p.creado_at DESC
  LIMIT 20;
END
$function$;

REVOKE ALL ON FUNCTION public.docs_cliente_pendientes() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.docs_cliente_pendientes() TO authenticated;

COMMENT ON FUNCTION public.docs_cliente_pendientes() IS
  '#4 · Widget Inicio: pedidos de doc abiertos con item subido (doc del cliente esperando revisión, incl. subida parcial). Staff-only.';
