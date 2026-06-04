-- ============================================================================
-- 0187 · Invariantes contables capitalizadas en la auditoría a fondo de E-GG-47
--
-- La auditoría 3-agentes del chunk E-GG-47 encontró dos invariantes que el
-- frontend asume pero la BD no enforce. Cualquier curl directo o consola SQL
-- las podía violar.
--
-- 1) Comprobante con CAE no se puede dejar en estado 'anulado'.
--    UI ya lo bloquea (ComprobanteDetailPage:!comp.cae para mostrar Anular),
--    pero un UPDATE manual o un bug futuro podía romperlo. Pre-condición:
--    0 filas en producción violando esto.
--
-- 2) Suma de imputaciones de un movimiento NO puede superar su monto.
--    El trigger existente recalcula `saldo_pendiente` del comprobante, pero
--    no impide inserts huérfanos que sobre-imputen. Pre-condición: 0 filas
--    en producción violando esto.
--
-- Postergados a chunk aparte (no en esta mig):
--  - Reapertura de trámites cerrados (requiere decidir si reabrir es válido).
--  - Partner rendición cancelada con re-atribución (más complejo).
-- ============================================================================

ALTER TABLE public.comprobantes
ADD CONSTRAINT chk_cae_no_anulable
  CHECK ((cae IS NULL) OR (estado <> 'anulado'));

COMMENT ON CONSTRAINT chk_cae_no_anulable ON public.comprobantes IS
  'E-GG-47 audit (2026-06-04) · Un comprobante con CAE ya pasó por ARCA. Anularlo viola régimen fiscal. Para deshacer, emitir NC.';

CREATE OR REPLACE FUNCTION public.trg_imp_validar_sum_no_supera_monto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sum_otros numeric;
  v_monto    numeric;
BEGIN
  SELECT monto INTO v_monto FROM public.movimientos WHERE id = NEW.movimiento_id;
  IF v_monto IS NULL THEN
    RAISE EXCEPTION 'movimiento_inexistente_para_imputacion' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(monto_imputado), 0)
    INTO v_sum_otros
    FROM public.movimiento_imputaciones
   WHERE movimiento_id = NEW.movimiento_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_sum_otros + NEW.monto_imputado) > v_monto + 0.001 THEN
    RAISE EXCEPTION 'imputacion_supera_monto_del_movimiento (suma=% monto=%)',
      v_sum_otros + NEW.monto_imputado, v_monto
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_imp_validar_sum ON public.movimiento_imputaciones;
CREATE TRIGGER trg_imp_validar_sum
  BEFORE INSERT OR UPDATE OF monto_imputado, movimiento_id
  ON public.movimiento_imputaciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_imp_validar_sum_no_supera_monto();

COMMENT ON FUNCTION public.trg_imp_validar_sum_no_supera_monto() IS
  'E-GG-47 audit · Bloquea inserts/updates de imputaciones que sobre-imputarían un movimiento. Defensa en profundidad al recalculo de saldo del comprobante.';
