-- =================================================================
-- Premisa "simple primero, factura opcional" (#150)
-- Todo comprobante puede nacer como tipo='X' (simple, no fiscal) y
-- ser transformado luego a A/B/C cuando se quiera facturar ante ARCA.
-- Mientras es simple, igual se puede cobrar/editar normalmente.
-- =================================================================

CREATE OR REPLACE FUNCTION public.comprobante_transformar_a_fiscal(
  p_comprobante_id uuid,
  p_nuevo_tipo     text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actual record;
  v_pv int;
  v_next_num int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede transformar comprobantes' USING ERRCODE = '42501';
  END IF;

  IF p_nuevo_tipo NOT IN ('A','B','C') THEN
    RAISE EXCEPTION 'Tipo destino inválido (esperado A/B/C, recibido %)', p_nuevo_tipo USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actual FROM public.comprobantes WHERE id = p_comprobante_id;
  IF v_actual.id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_actual.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede transformar un comprobante anulado' USING ERRCODE = '22023';
  END IF;
  IF v_actual.tipo <> 'X' THEN
    RAISE EXCEPTION 'Solo se pueden transformar comprobantes simples (tipo=X). Actual=%', v_actual.tipo USING ERRCODE = '22023';
  END IF;
  IF v_actual.emitido_arca = true THEN
    RAISE EXCEPTION 'Este comprobante ya fue enviado a ARCA' USING ERRCODE = '22023';
  END IF;

  -- Asignar próximo número del nuevo tipo+pv (reutiliza el pv existente)
  v_pv := v_actual.punto_venta;
  SELECT COALESCE(MAX(numero), 0) + 1
    INTO v_next_num
    FROM public.comprobantes
   WHERE tipo = p_nuevo_tipo AND punto_venta = v_pv;

  UPDATE public.comprobantes
     SET tipo = p_nuevo_tipo,
         numero = v_next_num,
         estado = 'borrador'   -- queda listo para enviar a ARCA cuando se confirme
   WHERE id = p_comprobante_id;

  RETURN p_comprobante_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.comprobante_transformar_a_fiscal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comprobante_transformar_a_fiscal(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.comprobante_transformar_a_fiscal IS
  '#150 · Cambia un comprobante simple (tipo=X) a fiscal (A/B/C). Asigna nuevo número, deja en borrador para que el flujo de ARCA lo emita.';