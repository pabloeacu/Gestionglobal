-- 0750 · DGG-275 / DDJJ F3 — Emisión masiva de comprobantes del trámite DDJJ.
--
-- RPC que emite, en un lote, los comprobantes de la presentación de DDJJ:
--   · modo 'unico'         → 1 comprobante a la administración (monto total).
--   · modo 'por_consorcio' → N comprobantes, uno por consorcio (receptor=consorcio,
--                            deudor=administración), con datos presumidos y EDITADOS
--                            fila por fila por la gerencia en la grilla (precio,
--                            alícuota, descripción, tipo).
--
-- Reutiliza `emitir_comprobante_manual` (carril SIMPLE, tipo X) por cada línea
-- (DRY: snapshot del receptor, numerador atómico, items y totales por trigger ya
-- probados) y estampa `comprobantes.tramite_id = p_tramite_id` (vínculo N:1 de
-- mig 0749) para que el gate de cierre y la cta cte vean TODOS los del lote.
--
-- FISCAL por línea: ARCA está dormido (nunca emitió en prod). El carril fiscal
-- (A/B/C vía crear_comprobante_borrador_fiscal) dejaría borradores colgados sin CAE,
-- y no es smoke-testeable hoy. Por eso esta RPC acepta SÓLO tipo 'simple' y rechaza
-- 'fiscal' con un error claro, por fila (no aborta el lote). El selector de tipo vive
-- en la grilla (UI) con 'fiscal' deshabilitado hasta activar ARCA. Cuando ARCA se
-- encienda, se extiende acá el ruteo a la vía fiscal (chunk aparte, flaggeado).
--
-- R5 (multi-tabla→RPC SECURITY DEFINER + search_path), R6 (GRANT), R12 (tenancy:
-- assert_administracion_access; gerentes bypassan), R16 (firma nueva única),
-- R18 (smoke e2e real — se ejercita en rollback al cerrar el chunk).

CREATE OR REPLACE FUNCTION public.tramite_emitir_comprobantes_ddjj(
  p_tramite_id uuid,
  p_modo text,
  p_lineas jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
  v_serv uuid;
  v_estado text;
  v_total int := 0;
  v_emitidos int := 0;
  v_errores int := 0;
  v_monto numeric(14,2) := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_primero uuid;
  v_row jsonb;
  v_idx int := 0;
  v_consorcio uuid;
  v_tipo_linea text;
  v_descripcion text;
  v_precio numeric(14,2);
  v_bonif numeric(5,2);
  v_alicuota text;
  v_concepto text;
  v_pv int;
  v_fecha date;
  v_venc date;
  v_obs text;
  v_comp uuid;
  v_comp_total numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  IF p_modo NOT IN ('unico', 'por_consorcio') THEN
    RAISE EXCEPTION 'modo inválido (unico|por_consorcio)' USING ERRCODE = '22023';
  END IF;

  SELECT administracion_id, servicio_id, estado
    INTO v_admin, v_serv, v_estado
    FROM public.tramites WHERE id = p_tramite_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Trámite inexistente o sin administración' USING ERRCODE = '22023';
  END IF;
  IF v_estado IN ('cerrado', 'cancelado') THEN
    RAISE EXCEPTION 'El trámite ya está % — no se pueden emitir comprobantes', v_estado USING ERRCODE = '22023';
  END IF;
  -- R12: tenancy. Gerentes bypassan; un administrador no alcanza esta RPC (is_staff).
  PERFORM private.assert_administracion_access(v_admin);

  v_total := coalesce(jsonb_array_length(p_lineas), 0);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay líneas para emitir' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_tipo_linea := coalesce(nullif(v_row->>'tipo', ''), 'simple');
      IF v_tipo_linea <> 'simple' THEN
        RAISE EXCEPTION 'Los comprobantes fiscales de DDJJ se habilitan al activar ARCA; por ahora sólo simples';
      END IF;

      v_consorcio := nullif(v_row->>'consorcio_id', '')::uuid;
      IF p_modo = 'por_consorcio' AND v_consorcio IS NULL THEN
        RAISE EXCEPTION 'Falta consorcio_id en la línea % (modo por_consorcio)', v_idx;
      END IF;
      IF p_modo = 'unico' THEN
        v_consorcio := NULL;  -- un comprobante a la administración
      END IF;

      v_descripcion := nullif(btrim(v_row->>'descripcion'), '');
      IF v_descripcion IS NULL THEN
        v_descripcion := 'Declaración jurada anual (RPAC)';
      END IF;
      v_precio := coalesce(nullif(v_row->>'precio', '')::numeric, 0);
      v_bonif := coalesce(nullif(v_row->>'bonificacion_porc', '')::numeric, 0);
      v_alicuota := coalesce(nullif(v_row->>'alicuota_iva', ''), 'exento');
      v_concepto := coalesce(nullif(v_row->>'concepto', ''), 'servicios');
      v_pv := coalesce(nullif(v_row->>'punto_venta', '')::int, 1);
      v_fecha := coalesce(nullif(v_row->>'fecha', '')::date, current_date);
      v_venc := coalesce(nullif(v_row->>'vencimiento', '')::date, current_date + 15);
      v_obs := nullif(btrim(v_row->>'observaciones'), '');

      v_comp := public.emitir_comprobante_manual(
        v_admin, v_consorcio, 'X', v_pv, v_fecha, v_venc, v_concepto,
        jsonb_build_array(jsonb_build_object(
          'descripcion', v_descripcion,
          'cantidad', 1,
          'precio_unitario', v_precio,
          'bonificacion_porc', v_bonif,
          'alicuota_iva', v_alicuota,
          'servicio_id', v_serv,
          'consorcio_id', v_consorcio
        )),
        v_obs, NULL);

      -- Vínculo N:1 (mig 0749): el gate/señales/cta cte ven todos los del lote.
      UPDATE public.comprobantes SET tramite_id = p_tramite_id WHERE id = v_comp;

      SELECT total INTO v_comp_total FROM public.comprobantes WHERE id = v_comp;
      v_monto := v_monto + coalesce(v_comp_total, 0);
      v_emitidos := v_emitidos + 1;
      IF v_primero IS NULL THEN v_primero := v_comp; END IF;
      v_ids := v_ids || to_jsonb(v_comp);
      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'consorcio_id', v_consorcio, 'comprobante_id', v_comp,
        'total', v_comp_total, 'resultado', 'emitido');

    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'consorcio_id', nullif(v_row->>'consorcio_id','')::uuid,
        'resultado', 'error', 'motivo', SQLERRM);
    END;
  END LOOP;

  -- Backward-compat de display: si el trámite no tenía comprobante linkeado, apuntar
  -- al primero del lote (el gate ya ve TODOS por tramite_id; esto es sólo para la ficha).
  IF v_primero IS NOT NULL THEN
    UPDATE public.tramites
       SET comprobante_id = v_primero, ultima_actividad_at = now()
     WHERE id = p_tramite_id AND comprobante_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'modo', p_modo,
    'total_lineas', v_total,
    'emitidos', v_emitidos,
    'errores', v_errores,
    'monto_total', v_monto,
    'primer_comprobante_id', v_primero,
    'comprobante_ids', v_ids,
    'detalle', v_detalle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb) IS
  'DGG-275 F3: emite el lote de comprobantes de la presentación DDJJ (único a la admin, o uno por consorcio: receptor=consorcio/deudor=admin). Reusa emitir_comprobante_manual (X) por línea y estampa tramite_id (vínculo N:1). Sólo simple (fiscal se habilita con ARCA). Sólo gerencia.';
