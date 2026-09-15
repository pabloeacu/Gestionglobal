-- 0486 · Auditoría 2026-09 · ROBUSTEZ / SSOT contable (Pieza A): unificar la definición de
-- "deuda de comprobante" a la regla canónica de Pablo.
--
-- REGLA CANÓNICA (Pablo, 2026-09-15): un comprobante es DEUDA si y sólo si `saldo_pendiente > 0`.
-- Las 3 formas de dejar de ser deuda (cobrado / compensado con nota de crédito / saldo 0.00) reducen
-- todas a saldo_pendiente = 0. Un pago parcial deja como deuda el saldo restante.
--
-- HALLAZGO (investigación SSOT §6): `cliente_deuda_neta` (la fuente que alimenta el PORTAL del cliente)
-- tenía un filtro EXTRA que ninguna otra superficie usa: `estado_cobranza NOT IN ('cancelado','anulado')`.
-- Eso hacía que un comprobante con saldo_pendiente>0 cuya COBRANZA figure 'cancelado'/'anulado' NO contara
-- como deuda en el portal, pero SÍ en gerencia (cuenta_corriente_resumen, cuenta_corriente_morosos,
-- kpis_dashboard_global, administraciones_con_deuda) → el mismo cliente podría ver deuda distinta en el
-- portal vs. gerencia. Contradice la regla de Pablo (lo único que borra deuda es saldo 0).
--
-- FIX: quitar ese filtro divergente. Así "deuda = saldo_pendiente>0 (sobre comprobantes no anulados/borrador),
-- neto del crédito disponible, piso 0" queda IDÉNTICO en todas las superficies de deuda del cliente.
--
-- SEGURO (no-op hoy): 0 comprobantes tienen saldo_pendiente>0 con estado_cobranza IN ('cancelado','anulado')
-- (verificado: filtro_afecta_hoy=0). El número del portal no cambia hoy (cdfce4c3=0, global=3.010.000 antes y
-- después); la corrección elimina la divergencia para cuando esos estados de cobranza se usen.
--
-- Firma idéntica → CREATE OR REPLACE sin riesgo de overload (R16). Preserva STABLE/SECURITY DEFINER/
-- search_path/TimeZone y el gate de acceso embebido (is_staff OR dueño de la administración).

CREATE OR REPLACE FUNCTION public.cliente_deuda_neta(p_administracion_id uuid)
 RETURNS TABLE(total numeric, pendientes_count integer, vencidos_count integer, proximo_vencimiento date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
  SELECT
    GREATEST(0, COALESCE(SUM(saldo_pendiente), 0)
                - public.administracion_credito_disponible(p_administracion_id))::numeric AS total,
    COUNT(*)::int AS pendientes_count,
    COUNT(*) FILTER (WHERE vencimiento < CURRENT_DATE)::int AS vencidos_count,
    MIN(vencimiento) FILTER (WHERE vencimiento >= CURRENT_DATE) AS proximo_vencimiento
  FROM public.comprobantes
  WHERE administracion_id = p_administracion_id
    AND saldo_pendiente > 0
    AND estado NOT IN ('anulado','borrador')
    AND (
      (SELECT private.is_staff())
      OR EXISTS (
        SELECT 1 FROM public.administraciones a
        WHERE a.id = p_administracion_id AND a.user_id = auth.uid()
      )
    );
$function$;
