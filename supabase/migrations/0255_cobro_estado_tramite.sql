-- ============================================================================
-- 0255_cobro_estado_tramite.sql
-- DGG-88 · El gate de cobranza usaba el booleano `cobro_pendiente` (saldo>0) y el
-- mensaje hardcodeaba "no tiene cobranza registrada", aun cuando el trámite tiene
-- un PAGO A CUENTA (saldo parcial). El gate lee bien; el mensaje no diferenciaba.
-- Campo calculado hermano de cobro_pendiente que distingue el caso, para que la UI
-- muestre el copy correcto. Mismo filtro que cobro_pendiente (comprobante propio o
-- vía solicitud; no anulado; total>0; saldo>0).
--   'parcial'      → hay al menos un comprobante con pago a cuenta (saldo < total)
--   'sin_cobranza' → impago sin ningún pago registrado (saldo = total)
--   NULL           → sin saldo pendiente (cobrado / sin comprobante)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cobro_estado(t public.tramites)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN bool_or(c.saldo_pendiente < c.total) THEN 'parcial'
    ELSE 'sin_cobranza'
  END
  FROM public.comprobantes c
  WHERE c.estado <> 'anulado'
    AND COALESCE(c.total, 0) > 0
    AND COALESCE(c.saldo_pendiente, 0) > 0
    AND (
      c.id = t.comprobante_id
      OR c.id IN (
        SELECT s.comprobante_id FROM public.solicitudes s
         WHERE s.tramite_id = t.id AND s.comprobante_id IS NOT NULL
      )
    );
$function$;
