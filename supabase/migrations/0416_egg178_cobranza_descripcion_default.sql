-- ============================================================================
-- 0416 · E-GG-178 — Cobranza "Sin descripción": default server-side
--
-- Caso Drozd (11/08/2026): JL revirtió una cobranza por caja equivocada y la
-- re-imputó desde el comprobante en la Cta. Cte. (RegistrarCobranzaDrawer).
-- Ese drawer tiene el campo descripción libre y vacío → el service manda ''
-- → la RPC hacía NULLIF(...) → movimiento con descripcion NULL → la grilla
-- muestra "Sin descripción". El wizard de emisión en cambio compone
-- 'Cobranza · <renglón>' del lado del cliente: asimetría entre superficies.
--
-- Fix canónico (consistencia contable absoluta): la RPC compone el default
-- 'Cobranza · <primer renglón del comprobante>' cuando p_descripcion viene
-- vacía — una sola fuente de verdad para TODAS las superficies presentes y
-- futuras. Si el comprobante no tiene renglones, cae a 'Cobranza · X 0001-…'.
-- Si el operador escribe algo, se respeta tal cual.
--
-- R16: misma firma (9 params) → CREATE OR REPLACE no crea overload (smoke al
-- cierre). R18: smoke e2e ejecutando la RPC con descripción vacía/explícita/
-- sin renglones. Incluye data-fix del movimiento del caso real.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid, p_caja_id uuid, p_fecha date, p_monto numeric,
  p_descripcion text, p_referencia text, p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid,
  p_permitir_excedente boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
  v_imputar numeric;
  v_descripcion text;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas' USING ERRCODE = '42501';
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

  -- E-GG-178: default de descripción server-side. Si el operador no escribió
  -- nada, se compone 'Cobranza · <primer renglón>' — mismo formato que el
  -- wizard de emisión, para que ninguna superficie deje "Sin descripción".
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
    estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    v_descripcion, NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid(), p_partner_id_atribucion
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, v_imputar
  );

  RETURN v_mov_id;
END;
$function$;

-- Data-fix del caso real (mov 110cc016, re-imputación de Drozd del 11/08):
-- completar la descripción con el renglón de su comprobante, solo si sigue NULL.
UPDATE public.movimientos m
SET descripcion = 'Cobranza · ' || (
  SELECT i.descripcion FROM public.items_comprobantes i
  WHERE i.comprobante_id = m.comprobante_id
  ORDER BY i.orden ASC, i.created_at ASC LIMIT 1
)
WHERE m.id = '110cc016-16ee-4f58-b061-336f6b810eef'
  AND m.descripcion IS NULL;
