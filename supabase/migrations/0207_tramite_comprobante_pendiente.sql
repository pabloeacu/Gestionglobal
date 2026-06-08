-- ============================================================================
-- 0207 · DGG-55 · Señal "Comprobante pendiente" en trámites
--
-- Pablo (2026-06-08): "Todos los trámites generan comprobante (los gratuitos en
-- 0.00) EXCEPTO las DDJJ, cuyo comprobante se emite al cerrar. Para no perder de
-- vista el seguimiento/cobranza de esos casos, queremos un chip + filtro
-- 'Comprobante pendiente' en trámites."
--
-- Diseño: computed column `comprobante_pendiente(tramites)` (PostgREST), espejo
-- de `cobro_pendiente` (DGG-44, mig 0193/0194). SECURITY INVOKER (respeta RLS).
--   comprobante_pendiente = el trámite NO está cerrado/cancelado
--                           Y no tiene NINGÚN comprobante no-anulado vinculado
--                           (ni por tramites.comprobante_id ni por
--                            solicitudes.tramite_id→comprobante_id).
--   · DDJJ (sin comprobante hasta el cierre)  → true  (chip)
--   · gratuito (comprobante 0.00 ya emitido)  → false
--   · pago (comprobante emitido)              → false
--   · cerrado / cancelado                     → false (caso resuelto)
--   · único comprobante anulado               → true  (hay que re-emitir)
--
-- Distinto de `cobro_pendiente` (tiene comprobante con costo pero impago): son
-- estados sucesivos (sin comprobante → comprobante impago → cobrado).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.comprobante_pendiente(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.estado NOT IN ('cerrado', 'cancelado')
    AND NOT EXISTS (
      SELECT 1
      FROM public.comprobantes c
      WHERE c.estado <> 'anulado'
        AND (
          c.id = t.comprobante_id
          OR c.id IN (
            SELECT s.comprobante_id
            FROM public.solicitudes s
            WHERE s.tramite_id = t.id
              AND s.comprobante_id IS NOT NULL
          )
        )
    );
$$;

COMMENT ON FUNCTION public.comprobante_pendiente(public.tramites) IS
  'DGG-55 · Computed column (PostgREST), SECURITY INVOKER. TRUE si el trámite no es terminal (cerrado/cancelado) y NO tiene comprobante no-anulado vinculado (por tramites.comprobante_id o solicitudes.tramite_id→comprobante_id). Capta las DDJJ (comprobante por emitir al cierre) y cualquier hueco. Señal para el chip + filtro "Comprobante pendiente".';

REVOKE EXECUTE ON FUNCTION public.comprobante_pendiente(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comprobante_pendiente(public.tramites) TO authenticated;
