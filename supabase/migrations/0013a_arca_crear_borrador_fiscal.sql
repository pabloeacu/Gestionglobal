-- ============================================================================
-- 0013a_arca_crear_borrador_fiscal · RPC para crear borradores fiscales (A/B/C
-- y sus NC/ND) que después la cola ARCA autorizará. NO consume numerador: el
-- número lo asigna AFIP via FECompUltimoAutorizado al autorizar el job.
-- Hermano del `emitir_comprobante_manual` de 0008 (que solo cubría tipo X).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crear_comprobante_borrador_fiscal(
  p_administracion_id uuid,
  p_consorcio_id      uuid,
  p_tipo              text,
  p_punto_venta       int,
  p_fecha             date,
  p_vencimiento       date,
  p_concepto          text,
  p_items             jsonb,
  p_observaciones     text,
  p_comprobante_referencia_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin       public.administraciones%ROWTYPE;
  v_consorcio   public.consorcios%ROWTYPE;
  v_comp_id     uuid;
  v_receptor_tipo text;
  v_receptor_num  text;
  v_receptor_rs   text;
  v_receptor_iva  text;
  v_receptor_dom  text;
  v_item        jsonb;
  v_orden       smallint := 1;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede emitir comprobantes';
  END IF;

  IF p_tipo NOT IN ('A','B','C','NC_A','NC_B','NC_C','ND_A','ND_B','ND_C') THEN
    RAISE EXCEPTION
      'crear_comprobante_borrador_fiscal solo acepta tipos fiscales A/B/C/NC/ND (no X). Recibido: %', p_tipo;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El comprobante necesita al menos un ítem';
  END IF;

  IF p_tipo LIKE 'NC\_%' ESCAPE '\' OR p_tipo LIKE 'ND\_%' ESCAPE '\' THEN
    IF p_comprobante_referencia_id IS NULL THEN
      RAISE EXCEPTION 'Las NC/ND requieren comprobante de referencia';
    END IF;
  END IF;

  SELECT * INTO v_admin FROM public.administraciones WHERE id = p_administracion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administración no encontrada';
  END IF;

  IF p_consorcio_id IS NOT NULL THEN
    SELECT * INTO v_consorcio FROM public.consorcios WHERE id = p_consorcio_id;
    IF NOT FOUND OR v_consorcio.administracion_id <> p_administracion_id THEN
      RAISE EXCEPTION 'Consorcio inválido para esta administración';
    END IF;
    IF v_consorcio.facturar_con_cuit_administracion THEN
      IF v_admin.cuit IS NULL THEN
        RAISE EXCEPTION 'La administración no tiene CUIT cargado';
      END IF;
      v_receptor_tipo := 'cuit';
      v_receptor_num  := v_admin.cuit;
      v_receptor_rs   := v_admin.nombre;
      v_receptor_iva  := COALESCE(v_admin.condicion_iva, 'consumidor_final');
      v_receptor_dom  := COALESCE(v_admin.domicilio_fiscal, v_admin.direccion);
    ELSE
      v_receptor_tipo := v_consorcio.tipo_documento;
      v_receptor_num  := v_consorcio.numero_documento;
      v_receptor_rs   := v_consorcio.nombre;
      v_receptor_iva  := COALESCE(v_consorcio.condicion_iva, 'consumidor_final');
      v_receptor_dom  := v_consorcio.domicilio;
    END IF;
  ELSE
    IF v_admin.cuit IS NULL THEN
      v_receptor_tipo := 'cf';
      v_receptor_num  := '0';
    ELSE
      v_receptor_tipo := 'cuit';
      v_receptor_num  := v_admin.cuit;
    END IF;
    v_receptor_rs   := v_admin.nombre;
    v_receptor_iva  := COALESCE(v_admin.condicion_iva, 'consumidor_final');
    v_receptor_dom  := COALESCE(v_admin.domicilio_fiscal, v_admin.direccion);
  END IF;

  INSERT INTO public.comprobantes (
    administracion_id, consorcio_id, tipo, punto_venta, numero,
    fecha, periodo, vencimiento, concepto,
    receptor_tipo_documento, receptor_numero_documento,
    receptor_razon_social, receptor_condicion_iva, receptor_domicilio,
    estado, estado_cobranza,
    comprobante_referencia_id, observaciones,
    origen, created_by
  ) VALUES (
    p_administracion_id, p_consorcio_id, p_tipo, p_punto_venta, NULL,
    p_fecha, date_trunc('month', p_fecha)::date, p_vencimiento, p_concepto,
    v_receptor_tipo, v_receptor_num,
    v_receptor_rs, v_receptor_iva, v_receptor_dom,
    'borrador', 'pendiente',
    p_comprobante_referencia_id, NULLIF(trim(p_observaciones), ''),
    'manual', auth.uid()
  ) RETURNING id INTO v_comp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.items_comprobantes (
      comprobante_id, orden, descripcion, cantidad, precio_unitario,
      bonificacion_porc, alicuota_iva, servicio_id, consorcio_id
    ) VALUES (
      v_comp_id, v_orden,
      v_item->>'descripcion',
      COALESCE((v_item->>'cantidad')::numeric, 1),
      (v_item->>'precio_unitario')::numeric,
      COALESCE((v_item->>'bonificacion_porc')::numeric, 0),
      COALESCE(v_item->>'alicuota_iva', '21'),
      NULLIF(v_item->>'servicio_id','')::uuid,
      NULLIF(v_item->>'consorcio_id','')::uuid
    );
    v_orden := v_orden + 1;
  END LOOP;

  RETURN v_comp_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_comprobante_borrador_fiscal(
  uuid, uuid, text, int, date, date, text, jsonb, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_comprobante_borrador_fiscal(
  uuid, uuid, text, int, date, date, text, jsonb, text, uuid
) TO authenticated;
