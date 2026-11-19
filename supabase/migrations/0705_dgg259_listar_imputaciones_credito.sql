-- 0705_dgg259_listar_imputaciones_credito.sql
-- DGG-259 Chunk 2 · fix de coherencia R14 en la cuenta corriente: distinguir una cobranza
-- DIRECTA de un SALDO A FAVOR aplicado. Para el crédito aplicado, "Anular el pago"
-- (fz_revertir_movimiento) rebota (el ingreso tiene crédito aplicado a otro comprobante);
-- esas filas deben ofrecer sólo "Quitar crédito" (desimputar). Esta RPC lista los ids de
-- imputación que son crédito aplicado (m.comprobante_id DISTINCT FROM mi.comprobante_id).
CREATE OR REPLACE FUNCTION public.listar_imputaciones_credito(p_administracion_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT mi.id
  FROM public.movimiento_imputaciones mi
  JOIN public.movimientos m ON m.id = mi.movimiento_id
  JOIN public.comprobantes c ON c.id = mi.comprobante_id
  WHERE private.is_staff()
    AND c.administracion_id = p_administracion_id
    AND m.comprobante_id IS DISTINCT FROM mi.comprobante_id;
$fn$;

REVOKE ALL ON FUNCTION public.listar_imputaciones_credito(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_imputaciones_credito(uuid) TO authenticated;
