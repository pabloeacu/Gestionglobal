-- 0479 · Auditoría 2026-09 · A-INTEG: idempotencia server-side en los RPC de dinero.
--
-- HALLAZGO: un doble-click (o reintento de red) al registrar un pago podía imputar
-- dinero DOS veces. `pago_conciliar` ya es idempotente (máquina de estados
-- estado<>'reportado' bajo FOR UPDATE). Los otros dos no:
--   · registrar_cobranza_comprobante: protección parcial (FOR UPDATE + chequeo de
--     saldo), pero un pago PARCIAL con saldo suficiente se duplica.
--   · curso_registrar_pago: sin ninguna guarda → doble-click = 2 ingresos.
--
-- FIX (decisión de Pablo = clave de idempotencia desde el front, único enfoque sin
-- falsos positivos): el front genera un UUID por INTENCIÓN de pago y lo pasa. Si el
-- backend ve el mismo key dos veces, NO duplica: devuelve el resultado original.
--   - Columna movimientos.idempotency_key + índice UNIQUE PARCIAL (permite NULL para
--     todos los movimientos que no la usan).
--   - Cada RPC acepta p_idempotency_key uuid DEFAULT NULL (ÚLTIMO parámetro, para no
--     romper el caller interno posicional de pago_conciliar). R16: DROP + CREATE (no
--     CREATE OR REPLACE, porque cambia la cantidad de args → overload).
--   - Lógica: si key provisto y ya existe un movimiento con ese key → devolver el
--     existente. Si no, hacer el trabajo e insertar con el key. Race-safe: si dos
--     requests idénticos corren a la vez, el UNIQUE dispara unique_violation en el
--     segundo → se captura y se devuelve el movimiento existente (idempotente).
--   - key NULL = comportamiento idéntico al actual (sin dedup) → callers viejos /
--     pago_conciliar no se ven afectados.
--
-- R18: smoke e2e con rollback ejecutado tras aplicar (mismo key → 1 fila; keys
-- distintos → 2; NULL → sin dedup; replay devuelve el original). R6: GRANTs re-
-- explicitados (authenticated + service_role; PUBLIC revocado; anon queda sin EXECUTE).

-- 1) Columna + índice único parcial
ALTER TABLE public.movimientos ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_idempotency_key
  ON public.movimientos (idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON COLUMN public.movimientos.idempotency_key IS
  'Clave de idempotencia provista por el front (una por intención de pago). Evita '
  'doble-imputación por doble-click/reintento. Migración 0479 (auditoría A-INTEG).';

-- 2) registrar_cobranza_comprobante (+ p_idempotency_key)
DROP FUNCTION IF EXISTS public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid, uuid, boolean);
CREATE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid,
  p_caja_id uuid,
  p_fecha date,
  p_monto numeric,
  p_descripcion text,
  p_referencia text,
  p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL,
  p_permitir_excedente boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
  v_imputar numeric;
  v_descripcion text;
  v_existing uuid;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas' USING ERRCODE = '42501';
  END IF;

  -- Idempotencia (A-INTEG): si ya hay un movimiento con esta clave, devolverlo.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  p_monto := round(p_monto, 2);
  IF p_monto IS NULL OR NOT (p_monto > 0) THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0 (recibido: %)', p_monto;
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede cobrar un comprobante anulado';
  END IF;

  IF p_monto > v_comp.saldo_pendiente THEN
    IF NOT p_permitir_excedente THEN
      RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) del comprobante',
        p_monto, v_comp.saldo_pendiente;
    END IF;
    v_imputar := v_comp.saldo_pendiente;
  ELSE
    v_imputar := p_monto;
  END IF;

  v_descripcion := NULLIF(trim(p_descripcion), '');
  IF v_descripcion IS NULL THEN
    SELECT 'Cobranza · ' || i.descripcion INTO v_descripcion
    FROM public.items_comprobantes i
    WHERE i.comprobante_id = p_comprobante_id AND NULLIF(trim(i.descripcion), '') IS NOT NULL
    ORDER BY i.orden ASC, i.created_at ASC
    LIMIT 1;
    IF v_descripcion IS NULL THEN
      v_descripcion := 'Cobranza · ' || v_comp.tipo || ' ' ||
        lpad(v_comp.punto_venta::text, 4, '0') || '-' ||
        COALESCE(lpad(v_comp.numero::text, 8, '0'), 's/n');
    END IF;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, comprobante_id,
    estado, origen, created_by, partner_id_atribucion, idempotency_key
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    v_descripcion, NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid(), p_partner_id_atribucion, p_idempotency_key
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, v_imputar
  );

  RETURN v_mov_id;
EXCEPTION WHEN unique_violation THEN
  -- Carrera: otro request con el mismo key ganó. Devolver el existente (idempotente).
  -- Si la violación fue de OTRA constraint (no la del key), el lookup no encuentra
  -- nada y se re-lanza el error original.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  RAISE;
END;
$function$;

-- Supabase aplica DEFAULT PRIVILEGES que otorgan EXECUTE a anon en toda función
-- nueva (raíz del tema T1); revocamos PUBLIC y anon para restaurar el estado
-- original (sólo authenticated + service_role; anon sin acceso).
REVOKE EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid, uuid, date, numeric, text, text, uuid, uuid, boolean, uuid) TO authenticated, service_role;

-- 3) curso_registrar_pago (+ p_idempotency_key)
DROP FUNCTION IF EXISTS public.curso_registrar_pago(uuid, numeric, uuid, text);
CREATE FUNCTION public.curso_registrar_pago(
  p_matricula_id uuid,
  p_monto numeric,
  p_caja_id uuid,
  p_observaciones text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede registrar pagos' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser positivo' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia (A-INTEG)
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

  SELECT * INTO v_matricula FROM public.curso_matriculas WHERE id = p_matricula_id;
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

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, estado, origen, created_by, idempotency_key
  ) VALUES (
    p_caja_id, CURRENT_DATE, 'ingreso', p_monto, v_categoria_id,
    'Campus · pago curso ' || COALESCE(v_curso.titulo, ''),
    COALESCE(p_observaciones, NULL),
    v_matricula.administracion_id, 'identificado', 'manual', auth.uid(), p_idempotency_key
  ) RETURNING id INTO v_movimiento_id;

  v_completo := COALESCE(v_curso.precio_lista, 0) <= 0
                OR p_monto >= v_curso.precio_lista - 0.009;

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
    UPDATE public.curso_matriculas
       SET estado_pago = 'pago_parcial'
     WHERE id = p_matricula_id AND estado_pago <> 'pago_parcial';
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

REVOKE EXECUTE ON FUNCTION public.curso_registrar_pago(uuid, numeric, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_registrar_pago(uuid, numeric, uuid, text, uuid) TO authenticated, service_role;
