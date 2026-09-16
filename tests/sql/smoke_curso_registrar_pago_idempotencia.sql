-- ============================================================================
-- SMOKE R18 · idempotencia de public.curso_registrar_pago
-- (Auditoría 2026-09 · Fase B / B1 · hallazgo A-INTEG · mig 0479 · pago de campus)
--
-- Qué prueba: la clave de idempotencia impide imputar dos veces el pago de una
-- matrícula de campus ante doble-click / reintento de la MISMA intención:
--   · mismo idempotency_key dos veces → 1 solo movimiento + idempotent_replay=true
--   · idempotency_key distinto        → 2º movimiento (no bloquea un pago legítimo)
--   · idempotency_key NULL (legacy)   → sin dedup: dos llamadas = dos movimientos
--
-- Cómo corre / cuándo: ver tests/sql/README.md. Fija request.jwt.claims a un gerente;
-- bajo esa identidad la RPC ESCRIBE de verdad (movimientos + estado_pago/condición) —
-- todo se REVIERTE con el ROLLBACK que fuerza el RAISE 'SMOKE_OK…'. NO persiste nada.
-- Resultado esperado: "falla" con token inicial  SMOKE_OK  → PASA. SMOKE_FAIL → regresión.
-- SMOKE_SKIP → sin datos. Cualquier otro error = fallo a investigar (no es PASA).
-- ============================================================================
DO $$
DECLARE
  v_mat uuid; v_caja uuid; v_gerente uuid;
  v_key uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
  n_key1 int; n_key2 int;
BEGIN
  SELECT id INTO v_mat     FROM public.curso_matriculas ORDER BY inscripto_at DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_caja    FROM public.cajas WHERE activo IS NOT FALSE ORDER BY created_at LIMIT 1;
  SELECT id INTO v_gerente FROM public.profiles WHERE role = 'gerente' ORDER BY created_at LIMIT 1;
  IF v_mat IS NULL OR v_caja IS NULL OR v_gerente IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: faltan datos base (mat=% caja=% gerente=%)', v_mat, v_caja, v_gerente;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gerente::text, 'role', 'authenticated')::text, true);

  r1 := public.curso_registrar_pago(v_mat, 1, v_caja, 'SMOKE R18', v_key);
  r2 := public.curso_registrar_pago(v_mat, 1, v_caja, 'SMOKE R18', v_key);   -- mismo key
  r3 := public.curso_registrar_pago(v_mat, 1, v_caja, 'SMOKE R18', v_key2);  -- key distinto
  r4 := public.curso_registrar_pago(v_mat, 1, v_caja, 'SMOKE R18', NULL);    -- key NULL (legacy)
  r5 := public.curso_registrar_pago(v_mat, 1, v_caja, 'SMOKE R18', NULL);    -- key NULL otra vez

  SELECT count(*) INTO n_key1 FROM public.movimientos WHERE idempotency_key = v_key;
  SELECT count(*) INTO n_key2 FROM public.movimientos WHERE idempotency_key = v_key2;

  IF NOT ( (r1->>'movimiento_id') = (r2->>'movimiento_id')       -- mismo key → mismo movimiento
           AND (r2->>'idempotent_replay') = 'true'               -- 2ª llamada = replay idempotente
           AND (r3->>'movimiento_id') <> (r1->>'movimiento_id')  -- key distinto → otro movimiento
           AND n_key1 = 1 AND n_key2 = 1
           AND (r4->>'movimiento_id') <> (r5->>'movimiento_id')  -- key NULL: sin dedup
           AND (r4->>'movimiento_id') <> (r1->>'movimiento_id') ) THEN
    RAISE EXCEPTION 'SMOKE_FAIL: r1.mov=% r2.mov=% replay=% r3.mov=% key1=% key2=% r4.mov=% r5.mov=%',
      r1->>'movimiento_id', r2->>'movimiento_id', r2->>'idempotent_replay', r3->>'movimiento_id', n_key1, n_key2, r4->>'movimiento_id', r5->>'movimiento_id';
  END IF;

  RAISE EXCEPTION 'SMOKE_OK (rollback forzado): curso_registrar_pago idempotente — mismo key=1 mov+replay, distinto key=2do mov, key NULL=sin dedup.';
END $$;
