-- ============================================================================
-- 0256_cobro_estado_hardening_y_cierre_copy.sql
-- DGG-88 · Cierre de la auditoría §6 del fix de copy del gate de cobranza.
-- (A) Hardening de cobro_estado (R3): faltaba REVOKE PUBLIC/anon + GRANT authenticated
--     + COMMENT, a diferencia de sus hermanas cobro_pendiente (0194) y
--     comprobante_pendiente (0207). RLS ya impedía el leak (anon sin policy → NULL),
--     pero alineamos defensa en profundidad y evitamos el advisor.
-- (B) El backstop de cierre (trg_tramite_cerrar_exige_cobrado, mig 0252) mostraba
--     siempre "Registrá la cobranza", aun con pago a cuenta. Ahora el RAISE distingue
--     parcial (→ "Completá") de sin cobranza (→ "Registrá"), igual que el hook de la
--     lista/kanban. Es la vía del detail page (CerrarTramiteDialog → tracking_cerrar).
-- ============================================================================

-- (A) Hardening de permisos
REVOKE EXECUTE ON FUNCTION public.cobro_estado(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobro_estado(public.tramites) TO authenticated;
COMMENT ON FUNCTION public.cobro_estado(public.tramites) IS
  'DGG-88 · Motivo del cobro pendiente para el copy del gate: ''parcial'' (pago a cuenta, saldo<total) | ''sin_cobranza'' (impago sin pagos) | NULL. Hermana de cobro_pendiente; mismo universo de comprobantes.';

-- (B) Backstop de cierre con copy diferenciado
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
    IF public.cobro_estado(NEW) = 'parcial' THEN
      RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.'
        USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
