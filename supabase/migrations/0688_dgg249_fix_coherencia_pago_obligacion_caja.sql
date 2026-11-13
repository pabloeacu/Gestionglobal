-- 0688 · DGG-249 fix (E-GG-276) · coherencia obligación↔caja al deshacer el pago de un egreso.
--
-- HALLAZGO (auditoría §6, fan-out de consumidores del nuevo movimiento 'pago_egreso'):
-- fz_anular_movimiento y fz_revertir_movimiento operaban sobre el movimiento que paga una
-- obligación de egreso SIN tocar egreso_pagos. Resultado reproducido e2e: la obligación quedaba
-- estado_pago='pagado' (saldo 0) mientras el movimiento de caja quedaba 'anulado'/revertido →
-- desincronización obligación↔caja (viola consistencia contable). El guard de imputaciones de
-- esas RPC no lo atrapaba porque el pago de egreso se vincula por egreso_pagos, no por
-- movimiento_imputaciones. Además no existía ninguna vía para deshacer un pago (anular_egreso
-- bloquea las obligaciones con pagos), dejando un pago equivocado trabado.
--
-- FIX (simétrico con la reversión de cobranzas del modelo de ingresos):
--   1) fz_anular_movimiento / fz_revertir_movimiento: si el movimiento es el pago de una
--      obligación (EXISTS egreso_pagos) → bloquear y dirigir a Obligaciones de pago.
--   2) Nueva RPC revertir_pagos_egreso(p_egreso_id, p_motivo): deshace de forma atómica el/los
--      pago(s) de una obligación — borra egreso_pagos (el trigger AFTER DELETE recalcula saldo/
--      estado_pago → vuelve a impaga/parcial) y anula el/los movimiento(s) de pago (salen de caja,
--      quedan excluidos de KPIs, sábana y rendición por estado='anulado'). Sin doble-conteo.
--
-- NOTA: a la fecha hay 0 filas en egreso_pagos (feature nueva), por lo que los guards no afectan
-- ningún movimiento pre-existente (incluidos los 128 egresos de caja históricos): regresión = 0.

-- ── 1a) fz_anular_movimiento + guard pago_egreso ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fz_anular_movimiento(p_movimiento_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- DGG-249 (E-GG-276): un movimiento que paga una obligación de egreso no se deshace desde caja;
  -- anularlo acá dejaría la obligación 'pagado' con la caja anulada (desync). Dirigir a Obligaciones.
  IF EXISTS (SELECT 1 FROM public.egreso_pagos ep WHERE ep.movimiento_id = p_movimiento_id) THEN
    RAISE EXCEPTION 'Este movimiento es el pago de una obligación de egreso. Deshacé el pago desde Finanzas › Obligaciones de pago.'
      USING ERRCODE = '22023';
  END IF;

  -- E-GG-47 guard 1: el original de un par revertido no se puede anular.
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido_no_se_puede_anular' USING ERRCODE = '22023';
  END IF;

  -- E-GG-47 guard 2: el contrasiento (origen='reversion') tampoco se anula.
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
$function$;

-- ── 1b) fz_revertir_movimiento + guard pago_egreso ───────────────────────────
CREATE OR REPLACE FUNCTION public.fz_revertir_movimiento(p_movimiento_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_mov record; v_par record; v_tipo_reverso text;
  v_nueva_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- DGG-249 (E-GG-276): el pago de una obligación de egreso se deshace desde Obligaciones, no desde
  -- caja; revertirlo acá generaría un contrasiento dejando la obligación 'pagado' (desync + doble
  -- conteo del movimiento revertido en la rendición del partner).
  IF EXISTS (SELECT 1 FROM public.egreso_pagos ep WHERE ep.movimiento_id = p_movimiento_id) THEN
    RAISE EXCEPTION 'Este movimiento es el pago de una obligación de egreso. Deshacé el pago desde Finanzas › Obligaciones de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_ya_revertido' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado = 'anulado' THEN
    RAISE EXCEPTION 'movimiento_anulado_no_se_revierte' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado = 'pendiente_id' THEN
    RAISE EXCEPTION 'Un ingreso sin identificar no se revierte — usá Anular (no impacta saldo) o identificalo primero.'
      USING ERRCODE = '22023';
  END IF;
  IF v_mov.origen = 'reversion' THEN
    RAISE EXCEPTION 'no_se_puede_revertir_un_contrasiento' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.movimiento_imputaciones mi
    WHERE mi.movimiento_id = p_movimiento_id
      AND mi.comprobante_id IS NOT NULL
      AND mi.comprobante_id IS DISTINCT FROM v_mov.comprobante_id
  ) THEN
    RAISE EXCEPTION 'Este ingreso tiene saldo a favor aplicado a otro comprobante. Desimputá esa aplicación antes de revertir el movimiento.'
      USING ERRCODE = '22023';
  END IF;

  v_tipo_reverso := CASE v_mov.tipo
    WHEN 'ingreso' THEN 'egreso'
    WHEN 'egreso' THEN 'ingreso'
    WHEN 'transferencia_in' THEN 'transferencia_out'
    WHEN 'transferencia_out' THEN 'transferencia_in'
  END;

  DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen,
    movimiento_revertido_id, created_by
  ) VALUES (
    v_mov.caja_id, CURRENT_DATE, v_tipo_reverso, v_mov.monto,
    'Reversión del ' || to_char(v_mov.fecha, 'DD/MM/YYYY')
      || CASE WHEN p_motivo IS NOT NULL THEN ' · ' || p_motivo ELSE '' END,
    v_mov.referencia, v_mov.administracion_id, v_mov.consorcio_id,
    'identificado', 'reversion', p_movimiento_id, auth.uid()
  )
  RETURNING id INTO v_nueva_id;

  UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = p_movimiento_id;

  IF v_mov.transferencia_pair_id IS NOT NULL THEN
    SELECT * INTO v_par FROM public.movimientos
     WHERE transferencia_pair_id = v_mov.transferencia_pair_id
       AND id <> p_movimiento_id AND revertido_at IS NULL FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = v_par.id;
      v_tipo_reverso := CASE v_par.tipo
        WHEN 'transferencia_in' THEN 'transferencia_out'
        WHEN 'transferencia_out' THEN 'transferencia_in'
        ELSE v_par.tipo
      END;
      INSERT INTO public.movimientos (
        caja_id, fecha, tipo, monto, descripcion, referencia,
        estado, origen, movimiento_revertido_id, created_by
      ) VALUES (
        v_par.caja_id, CURRENT_DATE, v_tipo_reverso, v_par.monto,
        'Reversión de transferencia · pareja', v_par.referencia,
        'identificado', 'reversion', v_par.id, auth.uid()
      );
      UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = v_par.id;
    END IF;
  END IF;

  RETURN v_nueva_id;
END;
$function$;

-- ── 2) RPC de reversión de pagos de una obligación ───────────────────────────
CREATE OR REPLACE FUNCTION public.revertir_pagos_egreso(p_egreso_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_eg public.egresos%ROWTYPE; v_n int := 0; v_p record; v_desc text;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede deshacer pagos de egreso' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_eg FROM public.egresos WHERE id = p_egreso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obligación de egreso no encontrada'; END IF;
  IF v_eg.estado = 'anulado' THEN RAISE EXCEPTION 'La obligación está anulada'; END IF;
  IF v_eg.estado_pago = 'pendiente' THEN
    RAISE EXCEPTION 'La obligación no tiene pagos para deshacer' USING ERRCODE = '22023';
  END IF;
  v_desc := COALESCE(NULLIF(trim(p_motivo), ''), 'Reversión de pago de obligación');
  FOR v_p IN SELECT ep.id AS ep_id, ep.movimiento_id FROM public.egreso_pagos ep WHERE ep.egreso_id = p_egreso_id LOOP
    -- borrar la imputación de pago → trigger AFTER DELETE recalcula saldo/estado_pago de la obligación
    DELETE FROM public.egreso_pagos WHERE id = v_p.ep_id;
    -- anular el movimiento de caja (sale de caja/KPIs/sábana/rendición por estado='anulado')
    UPDATE public.movimientos
       SET estado = 'anulado',
           motivo_pendiente = v_desc,
           updated_at = now()
     WHERE id = v_p.movimiento_id AND estado <> 'anulado';
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.revertir_pagos_egreso(uuid, text) TO authenticated;

-- R16 smoke: ninguna de las 3 firmas quedó duplicada
DO $smoke$
DECLARE v text;
BEGIN
  SELECT string_agg(proname||'='||c,', ') INTO v FROM (
    SELECT p.proname, count(*) c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fz_anular_movimiento','fz_revertir_movimiento','revertir_pagos_egreso')
    GROUP BY p.proname HAVING count(*) > 1) q;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'R16 overload duplicado: %', v; END IF;
END $smoke$;
