-- ============================================================================
-- 0008_rpc_facturacion · RPCs para emitir/anular comprobantes manualmente
-- (sin ARCA — tipo X, comprobantes simples del administrador). Phase 2A-1.
-- Reglas: 4 (no `from()` multitabla), 5 (RPC para multi-tabla), 12 (tenancy
-- guard), 11 (todas las FK ya tienen índice en 0004). E41 (CHECK regex).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- emitir_comprobante_manual · crea comprobante + items + numera + autoriza
-- Atómico: BEGIN ... END en una sola transacción. Si cualquier paso falla,
-- rollback (no se consume número). Usado para comprobantes tipo X (simples,
-- sin ARCA, sin CAE). El receptor se snapshotea desde administracion/consorcio
-- al momento de emitir (D04/D06).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_comprobante_manual(
  p_administracion_id uuid,
  p_consorcio_id      uuid,       -- nullable: servicio personal del admin
  p_tipo              text,       -- 'X' | 'NC_X' | 'ND_X' (sin ARCA)
  p_punto_venta       int,
  p_fecha             date,
  p_vencimiento       date,
  p_concepto          text,       -- 'productos' | 'servicios' | 'productos_servicios'
  p_items             jsonb,      -- [{descripcion,cantidad,precio_unitario,alicuota_iva,bonificacion_porc,servicio_id?,consorcio_id?}]
  p_observaciones     text,
  p_comprobante_referencia_id uuid  -- para NC/ND
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin       public.administraciones%ROWTYPE;
  v_consorcio   public.consorcios%ROWTYPE;
  v_comp_id     uuid;
  v_next_num    int;
  v_receptor_tipo text;
  v_receptor_num  text;
  v_receptor_rs   text;
  v_receptor_iva  text;
  v_receptor_dom  text;
  v_item        jsonb;
  v_orden       smallint := 1;
BEGIN
  -- Tenancy guard (regla 12). Gerentes/operadores bypassan; un administrador
  -- solo puede emitir sobre su propia administración.
  PERFORM private.assert_administracion_access(p_administracion_id);

  -- Solo staff puede emitir comprobantes; los administradores cliente leen.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede emitir comprobantes';
  END IF;

  -- Validar tipo permitido en este RPC (manual, sin ARCA).
  IF p_tipo NOT IN ('X','NC_X','ND_X') THEN
    RAISE EXCEPTION
      'emitir_comprobante_manual solo acepta tipo X / NC_X / ND_X (sin ARCA). Recibido: %', p_tipo;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El comprobante necesita al menos un ítem';
  END IF;

  -- NC/ND requiere referencia
  IF p_tipo IN ('NC_X','ND_X') AND p_comprobante_referencia_id IS NULL THEN
    RAISE EXCEPTION 'Las notas de crédito/débito requieren comprobante de referencia';
  END IF;

  SELECT * INTO v_admin FROM public.administraciones WHERE id = p_administracion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administración no encontrada';
  END IF;

  -- Snapshot del receptor: si hay consorcio_id, factura al consorcio
  -- (D06 — el "facturar_con_cuit_administracion" se honra mirando el flag).
  IF p_consorcio_id IS NOT NULL THEN
    SELECT * INTO v_consorcio FROM public.consorcios WHERE id = p_consorcio_id;
    IF NOT FOUND OR v_consorcio.administracion_id <> p_administracion_id THEN
      RAISE EXCEPTION 'Consorcio inválido para esta administración';
    END IF;
    IF v_consorcio.facturar_con_cuit_administracion THEN
      IF v_admin.cuit IS NULL THEN
        RAISE EXCEPTION 'La administración no tiene CUIT cargado: no se puede facturar consorcio con CUIT de la administración';
      END IF;
      v_receptor_tipo := 'cuit';
      v_receptor_num  := v_admin.cuit;
      v_receptor_rs   := v_admin.nombre;
      v_receptor_iva  := COALESCE(v_admin.condicion_iva, 'consumidor_final');
      v_receptor_dom  := COALESCE(v_admin.domicilio_fiscal, v_admin.direccion);
    ELSE
      v_receptor_tipo := v_consorcio.tipo_documento;  -- 'cuit' | 'dni_ficticio'
      v_receptor_num  := v_consorcio.numero_documento;
      v_receptor_rs   := v_consorcio.nombre;
      v_receptor_iva  := COALESCE(v_consorcio.condicion_iva, 'consumidor_final');
      v_receptor_dom  := v_consorcio.domicilio;
    END IF;
  ELSE
    -- Servicio personal del administrador
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

  -- Numerador atómico: UPSERT con FOR UPDATE implícito en ON CONFLICT.
  -- Garantiza secuencia gap-less por (punto_venta, tipo) sin race condition
  -- gracias al lock por PK + RETURNING.
  INSERT INTO public.numeradores (punto_venta, tipo, ultimo_numero, updated_at)
  VALUES (p_punto_venta, p_tipo, 1, now())
  ON CONFLICT (punto_venta, tipo)
  DO UPDATE SET
    ultimo_numero = public.numeradores.ultimo_numero + 1,
    updated_at = now()
  RETURNING ultimo_numero INTO v_next_num;

  -- Insertar comprobante en estado 'autorizado' directamente (manual, sin ARCA).
  INSERT INTO public.comprobantes (
    administracion_id, consorcio_id, tipo, punto_venta, numero,
    fecha, periodo, vencimiento, concepto,
    receptor_tipo_documento, receptor_numero_documento,
    receptor_razon_social, receptor_condicion_iva, receptor_domicilio,
    estado, estado_cobranza,
    comprobante_referencia_id, observaciones,
    origen, created_by
  ) VALUES (
    p_administracion_id, p_consorcio_id, p_tipo, p_punto_venta, v_next_num,
    p_fecha, date_trunc('month', p_fecha)::date, p_vencimiento, p_concepto,
    v_receptor_tipo, v_receptor_num,
    v_receptor_rs, v_receptor_iva, v_receptor_dom,
    'autorizado', 'pendiente',
    p_comprobante_referencia_id, NULLIF(trim(p_observaciones), ''),
    'manual', auth.uid()
  ) RETURNING id INTO v_comp_id;

  -- Insertar items. El trigger trg_items_calcular calcula subtotal/iva/total;
  -- trg_items_recalcular actualiza los totales del comprobante automáticamente.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.items_comprobantes (
      comprobante_id, orden, descripcion, cantidad, precio_unitario,
      bonificacion_porc, alicuota_iva, servicio_id, consorcio_id
    ) VALUES (
      v_comp_id,
      v_orden,
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

-- Solo authenticated puede invocarla; el cuerpo refuerza staff-only.
REVOKE EXECUTE ON FUNCTION public.emitir_comprobante_manual(
  uuid, uuid, text, int, date, date, text, jsonb, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_comprobante_manual(
  uuid, uuid, text, int, date, date, text, jsonb, text, uuid
) TO authenticated;

-- ----------------------------------------------------------------------------
-- anular_comprobante · marca un comprobante como anulado. Si tiene CAE no
-- puede anularse (debe emitirse NC); si es manual sin CAE puede anularse
-- siempre que no haya cobranzas imputadas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_comprobante(
  p_comprobante_id uuid,
  p_motivo text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_imputaciones_total numeric;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede anular comprobantes';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante ya está anulado';
  END IF;

  IF v_comp.cae IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede anular un comprobante con CAE (%). Emití una nota de crédito.', v_comp.cae;
  END IF;

  -- Si hay cobranzas, no permitir anulación (regla de negocio: primero
  -- desimputar las cobranzas).
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputaciones_total
  FROM public.movimiento_imputaciones
  WHERE comprobante_id = p_comprobante_id;

  IF v_imputaciones_total > 0 THEN
    RAISE EXCEPTION
      'El comprobante tiene cobranzas imputadas por % — desimputalas antes de anular',
      v_imputaciones_total;
  END IF;

  UPDATE public.comprobantes SET
    estado = 'anulado',
    estado_cobranza = 'anulado',
    motivo_rechazo = COALESCE(NULLIF(trim(p_motivo), ''), 'Anulación manual')
  WHERE id = p_comprobante_id;

  RETURN p_comprobante_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anular_comprobante(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_comprobante(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- peek_proximo_numero · devuelve cuál sería el próximo número sin consumirlo.
-- UI lo usa para previsualizar en el wizard de emisión.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peek_proximo_numero(
  p_punto_venta int,
  p_tipo text
) RETURNS int
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT ultimo_numero + 1
       FROM public.numeradores
       WHERE punto_venta = p_punto_venta AND tipo = p_tipo),
    1
  );
$$;

REVOKE EXECUTE ON FUNCTION public.peek_proximo_numero(int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peek_proximo_numero(int, text) TO authenticated;
