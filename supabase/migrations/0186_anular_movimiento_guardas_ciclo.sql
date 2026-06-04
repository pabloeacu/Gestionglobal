-- ============================================================================
-- 0186 · E-GG-47 · Guardas anti-inconsistencia en fz_anular_movimiento
--
-- Bug detectado por Pablo (2026-06-04): la RPC anula movimientos del par
-- de reversión, dejando contrasiento huérfano y caja inconsistente.
--
-- Reglas conceptuales nuevas:
--   - Un movimiento ya revertido NO se puede anular (el ciclo está cerrado).
--   - Un contrasiento (origen='reversion') NO se puede anular (dejaría
--     huérfano al original).
--
-- Smoke reproducido en producción con caja MP. Gestión Global:
--   Antes  = $125.000 (par revertido suma 0).
--   Anular original revertido → $-50.000 (delta -$175k).
--   Anular contrasiento       → $300.000 (delta +$175k).
--   Ambos casos se ejecutaban sin error: BUG.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fz_anular_movimiento(
  p_movimiento_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mov record;
  v_count integer;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente_o_ya_anulado' USING ERRCODE = 'P0002';
  END IF;

  -- E-GG-47 guard 1: el original de un par revertido no se puede anular.
  -- El ciclo ya está cerrado (cobré + rebobiné); anular acá deja el
  -- contrasiento del par sin compensar, generando inconsistencia de caja.
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido_no_se_puede_anular' USING ERRCODE = '22023';
  END IF;

  -- E-GG-47 guard 2: el contrasiento (origen='reversion') tampoco se anula.
  -- Anularlo dejaría al movimiento original del par sin compensar.
  IF v_mov.origen = 'reversion' THEN
    RAISE EXCEPTION 'movimiento_contrasiento_no_se_puede_anular' USING ERRCODE = '22023';
  END IF;

  -- Guard original (preserved): si tiene imputaciones, usar revertir.
  SELECT COUNT(*) INTO v_count FROM public.movimiento_imputaciones
   WHERE movimiento_id = p_movimiento_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'movimiento_con_imputaciones_usar_revertir' USING ERRCODE = '22023';
  END IF;

  UPDATE public.movimientos
     SET estado = 'anulado',
         motivo_pendiente = COALESCE(p_motivo, motivo_pendiente),
         updated_at = now()
   WHERE id = p_movimiento_id
     AND estado <> 'anulado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente_o_ya_anulado' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fz_anular_movimiento(uuid, text) IS
  'E-GG-47 · Anula movimiento solo si NO está revertido, NO es contrasiento, y NO tiene imputaciones. Para los otros casos usar fz_revertir_movimiento.';
