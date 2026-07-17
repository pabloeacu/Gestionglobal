-- 0363 · Decisiones de Pablo sobre la wave 8 (DGG · 2026-07-17).
--
-- (1) FEATURE · identificar un ingreso pendiente como "INGRESO DE LA CASA":
-- JL/Pablo: un movimiento bancario no identificado no siempre es el pago de un
-- cliente — puede ser un reintegro del banco por un concepto mal cobrado, un
-- ajuste, etc. La identificación ahora tiene dos caminos: "es de un cliente"
-- (flujo existente) o "no es de un cliente" (se documenta con categoría y/o
-- descripción y queda como ingreso operativo sin administración — no toca la
-- cta.cte de nadie, que es exactamente la semántica de un movimiento de la
-- casa). La caja no se re-impacta en ningún caso.
--
-- (2) CANDADO PREVENTIVO · aplicaciones sin comprobante deshabilitadas:
-- el XOR original (chk_imp_destino_xor, mig 0005) permite imputaciones "a
-- administración" sin comprobante que NINGÚN flujo usa (0 filas en prod) y que,
-- de aparecer, harían divergir las fórmulas de saldo a favor entre superficies
-- (listar_creditos resta TODAS las imputaciones; extracto/resumen sólo las de
-- comprobante — E-GG-142 anotado). Decisión Pablo: candado hasta que se diseñe
-- el flujo completo con fórmulas unificadas. Reversible: DROP CONSTRAINT.

-- ── 1 · Candado: toda imputación exige comprobante ───────────────────────────
ALTER TABLE public.movimiento_imputaciones
  ADD CONSTRAINT chk_imp_comprobante_requerido CHECK (comprobante_id IS NOT NULL);

-- ── 2 · fz_identificar_movimiento: +p_categoria_id +p_descripcion, admin opcional
-- R16: pasar de 5 a 7 parámetros crea overload con CREATE OR REPLACE →
-- DROP de la firma vieja + CREATE + re-GRANT.
DROP FUNCTION IF EXISTS public.fz_identificar_movimiento(uuid, uuid, uuid, numeric, uuid);

CREATE FUNCTION public.fz_identificar_movimiento(
  p_movimiento_id uuid,
  p_administracion_id uuid DEFAULT NULL,
  p_comprobante_id uuid DEFAULT NULL,
  p_monto_imputar numeric DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL,
  p_descripcion text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mov public.movimientos%ROWTYPE;
  v_comp_saldo numeric;
  v_monto numeric;
  v_imputado numeric := 0;
  v_cat_tipo text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_mov.tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_se_identifican' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado <> 'pendiente_id' THEN
    RAISE EXCEPTION 'El movimiento no está pendiente de identificar (estado %)', v_mov.estado
      USING ERRCODE = '22023';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido' USING ERRCODE = '22023';
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    SELECT tipo INTO v_cat_tipo FROM public.categorias_finanzas WHERE id = p_categoria_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'categoria_inexistente' USING ERRCODE = '22023';
    END IF;
    IF v_cat_tipo NOT IN ('ingreso','ambos') THEN
      RAISE EXCEPTION 'La categoría elegida no es de ingresos' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_administracion_id IS NULL THEN
    -- ── Rama CASA: no es de ningún cliente (reintegro bancario, ajuste, etc.)
    IF p_comprobante_id IS NOT NULL OR p_monto_imputar IS NOT NULL
       OR p_partner_id_atribucion IS NOT NULL THEN
      RAISE EXCEPTION 'Un ingreso sin cliente no admite comprobante ni partner' USING ERRCODE = '22023';
    END IF;
    -- El reconocimiento tiene que documentar QUÉ es: categoría y/o descripción.
    IF p_categoria_id IS NULL AND NULLIF(trim(COALESCE(p_descripcion, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Indicá la categoría o una descripción del ingreso para identificarlo' USING ERRCODE = '22023';
    END IF;
    UPDATE public.movimientos
       SET categoria_id = COALESCE(p_categoria_id, categoria_id),
           descripcion = COALESCE(NULLIF(trim(p_descripcion), ''), descripcion),
           estado = 'identificado',
           identificado_at = now(),
           identificado_by = auth.uid()
     WHERE id = p_movimiento_id;
    RETURN jsonb_build_object(
      'movimiento_id', p_movimiento_id,
      'modo', 'casa',
      'administracion_id', NULL,
      'imputado', 0,
      'saldo_a_favor_restante', 0
    );
  END IF;

  -- ── Rama CLIENTE (flujo original)
  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'administracion_inexistente' USING ERRCODE = '22023';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  UPDATE public.movimientos
     SET administracion_id = p_administracion_id,
         partner_id_atribucion = COALESCE(p_partner_id_atribucion, partner_id_atribucion),
         categoria_id = COALESCE(p_categoria_id, categoria_id),
         descripcion = COALESCE(NULLIF(trim(p_descripcion), ''), descripcion),
         estado = 'identificado',
         identificado_at = now(),
         identificado_by = auth.uid()
   WHERE id = p_movimiento_id;

  IF p_comprobante_id IS NOT NULL THEN
    SELECT saldo_pendiente INTO v_comp_saldo
      FROM public.comprobantes WHERE id = p_comprobante_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'comprobante_inexistente' USING ERRCODE = '22023';
    END IF;
    v_monto := COALESCE(p_monto_imputar, LEAST(v_mov.monto, COALESCE(v_comp_saldo, 0)));
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'El comprobante no tiene saldo pendiente para aplicar' USING ERRCODE = '22023';
    END IF;
    PERFORM public.imputar_credito_a_comprobante(p_movimiento_id, p_comprobante_id, v_monto);
    v_imputado := v_monto;
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', p_movimiento_id,
    'modo', 'cliente',
    'administracion_id', p_administracion_id,
    'imputado', v_imputado,
    'saldo_a_favor_restante', v_mov.monto
      - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                   WHERE mi.movimiento_id = p_movimiento_id), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fz_identificar_movimiento(uuid, uuid, uuid, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_identificar_movimiento(uuid, uuid, uuid, numeric, uuid, uuid, text) TO authenticated, service_role;
