-- 0525_dgg214_hardening_revoke_anon_guard_pedido.sql
-- DGG-214 · hardening capitalizado de la revisión adversarial §6.
--   #1 (seguridad / coherencia con 0515): las RPCs nuevas de 0524 quedaron con
--      EXECUTE a anon por los default privileges de Supabase. No es explotable
--      (is_staff()=false para anon → RAISE), pero rompe el patrón establecido.
--      Revocamos anon/PUBLIC y re-afirmamos authenticated.
--   #3 (lógica): gerente_eliminar_avance_tracking no bloqueaba borrar la línea
--      ancla de un pedido de documentación ABIERTO → dejaría el pedido abierto
--      sin su tarjeta en el timeline. Agregamos guard: si la línea pertenece a
--      un pedido 'abierto', redirigir a "Anular pedido". Tras anular (pedido
--      'cancelado') la línea sí se puede borrar.

-- #1 · cerrar el EXECUTE a anon/PUBLIC (defensa en profundidad)
REVOKE EXECUTE ON FUNCTION public.tramite_pedido_doc_cancelar(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gerente_eliminar_avance_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_pedido_doc_cancelar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerente_eliminar_avance_tracking(uuid) TO authenticated;

-- #3 · guard: no borrar la línea ancla de un pedido abierto
CREATE OR REPLACE FUNCTION public.gerente_eliminar_avance_tracking(p_linea_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_pedido_id uuid;
  v_pedido_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede eliminar avances del tracking';
  END IF;

  SELECT pedido_id INTO v_pedido_id FROM public.tracking_lineas WHERE id = p_linea_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El avance no existe';
  END IF;

  -- Si la línea es la ancla de un pedido de documentación ABIERTO, no se borra
  -- suelta: hay que anular el pedido (así el panel de documentación y el
  -- timeline quedan consistentes). Una vez anulado, la línea sí es borrable.
  IF v_pedido_id IS NOT NULL THEN
    SELECT estado INTO v_pedido_estado FROM public.tramite_pedidos_doc WHERE id = v_pedido_id;
    IF v_pedido_estado = 'abierto' THEN
      RAISE EXCEPTION 'Este avance corresponde a un pedido de documentación abierto. Para quitarlo, anulá el pedido desde el panel de documentación.';
    END IF;
  END IF;

  DELETE FROM public.tracking_lineas WHERE id = p_linea_id;
END;
$fn$;

-- Re-afirmar el GRANT tras el CREATE OR REPLACE (por si cambió el owner/acl)
REVOKE EXECUTE ON FUNCTION public.gerente_eliminar_avance_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerente_eliminar_avance_tracking(uuid) TO authenticated;
