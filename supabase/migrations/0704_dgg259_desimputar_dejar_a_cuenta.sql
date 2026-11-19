-- 0704_dgg259_desimputar_dejar_a_cuenta.sql
-- DGG-259 Chunk 2 · Caso 2 de "revertir cobranza": desimputar DEJANDO el pago a cuenta
-- (saldo a favor del cliente, reaplicable a otro comprobante). A diferencia de
-- desimputar_cobranza (que borra el movimiento de una cobranza directa), acá el
-- movimiento SOBREVIVE como ingreso no imputado → aparece como "Saldo a favor" en la
-- cuenta corriente. El Caso 1 ("anular el pago" con contra-asiento) usa fz_revertir_movimiento.
CREATE OR REPLACE FUNCTION public.desimputar_dejar_a_cuenta(p_imputacion_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_imp public.movimiento_imputaciones%ROWTYPE;
  v_mov public.movimientos%ROWTYPE;
  v_adm uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede revertir cobranzas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_imp FROM public.movimiento_imputaciones WHERE id = p_imputacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imputación no encontrada' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = v_imp.movimiento_id FOR UPDATE;
  IF v_mov.origen = 'reversion' THEN
    RAISE EXCEPTION 'No se puede operar sobre un contra-asiento de reversión' USING ERRCODE = '22023';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'El movimiento ya fue revertido' USING ERRCODE = '22023';
  END IF;

  -- Borrar SÓLO la imputación: el ingreso queda como saldo a favor del cliente.
  DELETE FROM public.movimiento_imputaciones WHERE id = p_imputacion_id;

  -- Garantizar que el ingreso quede atribuido a la administración para figurar como crédito.
  IF v_mov.administracion_id IS NULL THEN
    SELECT administracion_id INTO v_adm FROM public.comprobantes WHERE id = v_imp.comprobante_id;
    IF v_adm IS NOT NULL THEN
      UPDATE public.movimientos SET administracion_id = v_adm, updated_at = now() WHERE id = v_mov.id;
    END IF;
  END IF;

  RETURN v_imp.comprobante_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.desimputar_dejar_a_cuenta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desimputar_dejar_a_cuenta(uuid) TO authenticated;
