-- ============================================================================
-- SMOKE R18 · idempotencia de public.registrar_cobranza_comprobante
-- (Auditoría 2026-09 · Fase B / B1 · hallazgo A-INTEG · mig 0479)
--
-- Qué prueba: la clave de idempotencia impide imputar dinero dos veces ante un
-- doble-click / reintento de red de la MISMA intención de pago:
--   · mismo idempotency_key dos veces  → 1 solo movimiento + 1 sola imputación
--   · idempotency_key distinto         → 2º movimiento (no bloquea un pago legítimo)
--   · idempotency_key NULL (legacy)    → sin dedup: dos llamadas = dos movimientos
--
-- Cómo corre: elige en runtime un comprobante con saldo>0, una caja activa y un
-- gerente (para is_staff()=true). Fija request.jwt.claims a ese gerente; bajo esa
-- identidad la RPC hace ESCRITURAS REALES (movimientos, imputaciones, y el trigger
-- que recalcula saldo) — que se REVIERTEN íntegras: el bloque termina con
-- RAISE EXCEPTION 'SMOKE_OK…' que fuerza el ROLLBACK y NO persiste NADA.
-- Se paga con p_permitir_excedente=true para no depender del saldo exacto del
-- comprobante elegido (si el monto supera el saldo, imputa el remanente en vez de
-- abortar; el invariante cuenta FILAS de imputación, no montos).
--
-- Resultado esperado: la ejecución "falla" con un mensaje cuyo token inicial es
--   SMOKE_OK   → PASA (todo revertido). Cualquier otro texto (SMOKE_FAIL, SMOKE_SKIP,
-- error de auth/saldo, etc.) NO es un PASA: es un fallo del smoke a investigar.
--
-- Cuándo correrlo (R18): antes de mergear cualquier migración que toque el
-- INSERT/UPDATE de una RPC de dinero.
-- ============================================================================
DO $$
DECLARE
  v_comp uuid;
  v_caja uuid;
  v_gerente uuid;
  v_key uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid;
  n_key1 int; n_imp int; n_key2 int;
BEGIN
  SELECT id INTO v_comp    FROM public.comprobantes WHERE saldo_pendiente > 0 AND estado <> 'anulado' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_caja    FROM public.cajas        WHERE activo IS NOT FALSE ORDER BY created_at LIMIT 1;
  SELECT id INTO v_gerente FROM public.profiles     WHERE role = 'gerente'    ORDER BY created_at LIMIT 1;
  IF v_comp IS NULL OR v_caja IS NULL OR v_gerente IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: faltan datos base (comp=% caja=% gerente=%)', v_comp, v_caja, v_gerente;
  END IF;

  -- Identidad de gerente sólo para pasar is_staff(); la RPC ESCRIBE de verdad y se revierte con el ROLLBACK.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gerente::text, 'role', 'authenticated')::text, true);

  -- p_permitir_excedente=>true: robusto ante el saldo del comprobante elegido.
  v1 := public.registrar_cobranza_comprobante(v_comp, v_caja, current_date, 1, 'SMOKE R18', NULL, NULL, NULL, true, v_key);
  v2 := public.registrar_cobranza_comprobante(v_comp, v_caja, current_date, 1, 'SMOKE R18', NULL, NULL, NULL, true, v_key);   -- mismo key
  v3 := public.registrar_cobranza_comprobante(v_comp, v_caja, current_date, 1, 'SMOKE R18', NULL, NULL, NULL, true, v_key2);  -- key distinto
  v4 := public.registrar_cobranza_comprobante(v_comp, v_caja, current_date, 1, 'SMOKE R18', NULL, NULL, NULL, true, NULL);    -- key NULL (legacy)
  v5 := public.registrar_cobranza_comprobante(v_comp, v_caja, current_date, 1, 'SMOKE R18', NULL, NULL, NULL, true, NULL);    -- key NULL otra vez

  SELECT count(*) INTO n_key1 FROM public.movimientos WHERE idempotency_key = v_key;
  SELECT count(*) INTO n_key2 FROM public.movimientos WHERE idempotency_key = v_key2;
  SELECT count(*) INTO n_imp  FROM public.movimiento_imputaciones WHERE movimiento_id IN (v1, v2);

  IF NOT (v1 = v2                       -- mismo key → mismo movimiento (dedup)
          AND v3 <> v1                  -- key distinto → otro movimiento
          AND n_key1 = 1                -- 1 sola fila para el key repetido
          AND n_imp = 1                 -- 1 sola imputación (no duplica dinero)
          AND n_key2 = 1                -- key distinto = 1 movimiento
          AND v4 <> v5                  -- key NULL: sin dedup → dos movimientos distintos
          AND v4 <> v1 AND v5 <> v1) THEN
    RAISE EXCEPTION 'SMOKE_FAIL: v1=v2? % | v3<>v1? % | mov_key1=% | imput=% | mov_key2=% | v4<>v5? %',
      (v1 = v2), (v3 <> v1), n_key1, n_imp, n_key2, (v4 <> v5);
  END IF;

  RAISE EXCEPTION 'SMOKE_OK (rollback forzado): idempotencia verificada — mismo key=1 mov/1 imput, distinto key=2do mov, key NULL=sin dedup.';
END $$;
