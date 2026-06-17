-- ============================================================================
-- 0252_cerrar_tramite_exige_cobrado.sql
-- DGG-88 · Regla dura: NO se puede CERRAR un trámite con cobro pendiente.
-- "Resuelto" = trabajo hecho (puede estar impago). "Cerrado" = además cobrado,
-- sin pendientes. La excepción (incobrable/bonificado) se ejerce resolviendo la
-- cobranza (anular o bonificar el comprobante → saldo 0 → cobro_pendiente=false).
-- Aplica a CUALQUIER trámite (incluidos los de categoría 'curso').
--
-- Trigger separado y acotado (BEFORE UPDATE OF estado, WHEN transición→cerrado)
-- para NO tocar el tramite_on_update existente. SECURITY DEFINER: cobro_pendiente
-- lee comprobantes/solicitudes sin chocar con RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.estado = 'cerrado'
     AND OLD.estado IS DISTINCT FROM 'cerrado'
     AND public.cobro_pendiente(NEW) THEN
    RAISE EXCEPTION 'No se puede cerrar un trámite con cobro pendiente. Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tramite_cerrar_exige_cobrado ON public.tramites;
CREATE TRIGGER trg_tramite_cerrar_exige_cobrado
  BEFORE UPDATE OF estado ON public.tramites
  FOR EACH ROW
  WHEN (NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado')
  EXECUTE FUNCTION public.tramite_cerrar_exige_cobrado();
