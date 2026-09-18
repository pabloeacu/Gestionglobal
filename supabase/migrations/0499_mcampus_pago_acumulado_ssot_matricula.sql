-- 0499 · M-CAMPUS (auditoría 2026-09 · E-GG-213): el "pago completo" de una matrícula
-- de curso se deriva del ACUMULADO real de pagos (SSOT = movimientos.matricula_id),
-- NO del monto de un solo pago.
--
-- BUG (latente, 0 víctimas hoy): `curso_registrar_pago` calculaba
--   v_completo := p_monto >= precio_lista
-- usando el monto de ESE pago. Un curso con precio real pagado en CUOTAS nunca
-- completaba (cada cuota < precio) → la condición 'pago' de matrícula nunca se marcaba
-- cumplida → el certificado quedaba retenido injustamente. Hoy no muerde porque el
-- único curso con matrículas parciales tiene precio_lista NULL (auto-completa), pero
-- muerde apenas un curso tenga precio y se cobre en cuotas.
--
-- FIX (aditivo + sin backfill + sin degradar):
--   (1) movimientos.matricula_id → vincula cada pago de campus a su matrícula (SSOT).
--   (2) curso_registrar_pago setea ese vínculo y deriva v_completo del SUM acumulado.
--   (3) el branch parcial NUNCA degrada una matrícula ya 'pago_completo' (defensa).
-- NO se backfillean estados existentes: las 16 parciales tienen 0 pagos (correctamente
-- parciales); las 85 completas quedan intactas (guard anti-degradación). Los pagos
-- históricos no se re-vinculan (ambiguo admin↔matrícula); a futuro cada pago se linkea.

-- ── (1) SSOT: vínculo pago ↔ matrícula (aditivo, nullable, FK con índice R11) ──────────
ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS matricula_id uuid
    REFERENCES public.curso_matriculas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.movimientos.matricula_id IS
  'Vincula un pago de campus a su matrícula de curso (SSOT del pago acumulado). NULL para movimientos no-campus. M-CAMPUS / E-GG-213 (mig 0499).';

-- R11: toda FK con su índice (Postgres NO lo crea). Parcial: sólo filas de campus.
CREATE INDEX IF NOT EXISTS idx_movimientos_matricula_id
  ON public.movimientos(matricula_id) WHERE matricula_id IS NOT NULL;

-- ── (2)+(3) RPC: acumulado + link + no-degradar. Misma firma → CREATE OR REPLACE (R16). ─
CREATE OR REPLACE FUNCTION public.curso_registrar_pago(p_matricula_id uuid, p_monto numeric, p_caja_id uuid, p_observaciones text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_matricula record;
  v_curso record;
  v_categoria_id uuid;
  v_movimiento_id uuid;
  v_cond_id uuid;
  v_completo boolean;
  v_existing uuid;
  v_pagado_total numeric;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede registrar pagos' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser positivo' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'movimiento_id', v_existing,
        'condicion_pago_id', NULL,
        'pago_completo', (SELECT estado_pago = 'pago_completo' FROM public.curso_matriculas WHERE id = p_matricula_id),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- FOR UPDATE: serializa pagos concurrentes de la MISMA matrícula → el SUM acumulado
  -- de abajo siempre ve los pagos previos (evita que 2 cuotas simultáneas queden ambas
  -- 'pago_parcial' sumando el total). §6 hallazgo E (2026-09-17).
  SELECT * INTO v_matricula FROM public.curso_matriculas WHERE id = p_matricula_id FOR UPDATE;
  IF v_matricula.id IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_curso FROM public.cursos WHERE id = v_matricula.curso_id;

  SELECT id INTO v_categoria_id
    FROM public.categorias_finanzas WHERE nombre = 'Cursos / Campus';
  IF v_categoria_id IS NULL THEN
    INSERT INTO public.categorias_finanzas (nombre, tipo, icono)
    VALUES ('Cursos / Campus', 'ingreso', 'graduation-cap')
    ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_categoria_id;
  END IF;

  -- El movimiento se vincula a la matrícula (SSOT del acumulado).
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, estado, origen, created_by, idempotency_key, matricula_id
  ) VALUES (
    p_caja_id, CURRENT_DATE, 'ingreso', p_monto, v_categoria_id,
    'Campus · pago curso ' || COALESCE(v_curso.titulo, ''),
    COALESCE(p_observaciones, NULL),
    v_matricula.administracion_id, 'identificado', 'manual', auth.uid(), p_idempotency_key,
    p_matricula_id
  ) RETURNING id INTO v_movimiento_id;

  -- "Completo" = ACUMULADO de la matrícula ≥ precio (incluye este pago recién insertado).
  SELECT COALESCE(SUM(monto), 0) INTO v_pagado_total
    FROM public.movimientos
   WHERE matricula_id = p_matricula_id
     AND tipo = 'ingreso'
     AND estado NOT IN ('anulado', 'revertido');

  v_completo := COALESCE(v_curso.precio_lista, 0) <= 0
                OR v_pagado_total >= v_curso.precio_lista - 0.009;

  IF v_completo THEN
    UPDATE public.matricula_condiciones mc
       SET cumplida = true, cumplida_at = now(), cumplida_por = auth.uid(),
           observaciones = COALESCE(p_observaciones, mc.observaciones)
      FROM public.curso_condiciones_config cc
     WHERE mc.condicion_id = cc.id
       AND mc.matricula_id = p_matricula_id
       AND cc.tipo = 'pago'
    RETURNING mc.id INTO v_cond_id;
    UPDATE public.curso_matriculas
       SET estado_pago = 'pago_completo'
     WHERE id = p_matricula_id AND estado_pago <> 'pago_completo';
  ELSE
    -- NUNCA degradar una matrícula ya completa (defensa; con acumulado la suma sólo
    -- crece en este flujo, así que este branch no toca completas).
    UPDATE public.curso_matriculas
       SET estado_pago = 'pago_parcial'
     WHERE id = p_matricula_id AND estado_pago NOT IN ('pago_parcial', 'pago_completo');
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', v_movimiento_id,
    'condicion_pago_id', v_cond_id,
    'pago_completo', v_completo
  );
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'movimiento_id', v_existing,
        'condicion_pago_id', NULL,
        'pago_completo', (SELECT estado_pago = 'pago_completo' FROM public.curso_matriculas WHERE id = p_matricula_id),
        'idempotent_replay', true
      );
    END IF;
  END IF;
  RAISE;
END;
$function$;
