-- 0751 · DGG-275 / DDJJ F3 — Fixes de la auditoría §6 adversarial (críticos contables).
--
-- #1 (D1, CRÍTICA) — `tramite_cancelar` era un 6º lector/ESCRITOR del vínculo
--    comprobante↔trámite que el sweep de 0749 omitió. Al cancelar un trámite DDJJ
--    con lote por-consorcio y p_anular_comprobante=true, su loop sólo matcheaba
--    `tramites.comprobante_id` (el PRIMERO, backfilleado por 0750) → anulaba 1 y
--    dejaba los otros N-1 VIVOS con saldo: deuda fantasma de un trámite cancelado
--    (reintroduce la regresión que DGG-95 cerró). Fix: agregar `OR c.tramite_id`.
--    Además `v_saldo_favor` (informativo del toast) pasa a cobranzas reales
--    (SUM monto_imputado) para coincidir con el diálogo (D2) y con el fix NC de 0703.
--
-- #3 (CRÍTICA) — al reconstruir `tramite_cobro_resumen`, 0749 se basó por error en
--    el cuerpo viejo (0270) y REVIRTIÓ el fix (8) de 0703 (DGG-259): `pagado_anulable`
--    volvió a `sum(total − saldo)` en vez de `sum(monto_imputado)` → con una nota de
--    crédito, el diálogo de cancelación mostraba un saldo-a-favor INFLADO (afecta a
--    TODO trámite con NC, no sólo DDJJ). Fix: reconstruir sobre el cuerpo de 0703
--    (cobranzas reales) + el 3er camino `tramite_id` + exponer `cantidad` (pluralizar).
--
-- #B1/#B3/#B6 — blindaje de `tramite_emitir_comprobantes_ddjj`: el EXCEPTION handler
--    re-casteaba el `consorcio_id` crudo a uuid (si venía texto no-UUID, relanzaba y
--    abortaba TODO el lote en vez de aislar la fila); modo 'unico' no validaba 1 línea;
--    `p_lineas` no-array reventaba fuera del try/catch. + guard de idempotencia
--    (no re-emitir si ya hay comprobantes no-anulados del trámite, salvo p_forzar).
--    DROP+CREATE para sumar p_forzar (R16: se dropea la firma de 3 args de 0750).

-- ───────────── #1 · tramite_cancelar ve TODO el lote ─────────────
CREATE OR REPLACE FUNCTION public.tramite_cancelar(
  p_tramite_id uuid,
  p_anular_comprobante boolean DEFAULT false,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite public.tramites%ROWTYPE;
  v_anulados uuid[] := '{}';
  v_omitidos_cae uuid[] := '{}';
  v_saldo_favor numeric := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE='42501'; END IF;
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede cancelar trámites' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El trámite no existe' USING ERRCODE='P0002'; END IF;

  IF p_anular_comprobante THEN
    FOR r IN
      SELECT DISTINCT c.id, c.cae, c.total, c.saldo_pendiente
        FROM public.comprobantes c
       WHERE c.estado <> 'anulado'
         AND ( c.id = v_tramite.comprobante_id
               OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                            WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL)
               OR c.tramite_id = p_tramite_id )   -- DGG-275 F3: lote por-consorcio
    LOOP
      IF r.cae IS NOT NULL THEN
        v_omitidos_cae := array_append(v_omitidos_cae, r.id);
      ELSE
        -- Lo cobrado (cobranzas reales, no total−saldo; coherente con 0703/el diálogo)
        -- queda como saldo a favor al borrar las imputaciones dentro de anular_comprobante.
        v_saldo_favor := v_saldo_favor + COALESCE(
          (SELECT SUM(mi.monto_imputado) FROM public.movimiento_imputaciones mi
            WHERE mi.comprobante_id = r.id), 0);
        PERFORM public.anular_comprobante(
          r.id,
          COALESCE(NULLIF(btrim(p_motivo),''), 'Trámite cancelado ' || COALESCE(v_tramite.codigo,''))
        );
        v_anulados := array_append(v_anulados, r.id);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.tramites SET estado = 'cancelado' WHERE id = p_tramite_id;

  RETURN jsonb_build_object(
    'ok', true,
    'anulados', to_jsonb(v_anulados),
    'omitidos_cae', to_jsonb(v_omitidos_cae),
    'saldo_a_favor', v_saldo_favor
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tramite_cancelar(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_cancelar(uuid, boolean, text) TO authenticated;

-- ───────────── #3 · tramite_cobro_resumen restaurado (cobranzas reales + tramite_id + cantidad) ─────────────
CREATE OR REPLACE FUNCTION public.tramite_cobro_resumen(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  WITH comps AS (
    SELECT c.id, c.cae, c.total, c.saldo_pendiente,
           COALESCE((SELECT SUM(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                      WHERE mi.comprobante_id = c.id), 0) AS cobrado
      FROM public.comprobantes c
      JOIN public.tramites t ON t.id = p_tramite_id
     WHERE c.estado <> 'anulado'
       AND ( c.id = t.comprobante_id
             OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                          WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL)
             OR c.tramite_id = p_tramite_id )     -- DGG-275 F3: lote por-consorcio
  )
  SELECT jsonb_build_object(
    'tiene_comprobante', EXISTS(SELECT 1 FROM comps),
    'tiene_anulable',    EXISTS(SELECT 1 FROM comps WHERE cae IS NULL),
    'tiene_cae',         EXISTS(SELECT 1 FROM comps WHERE cae IS NOT NULL),
    'cantidad',          (SELECT count(*) FROM comps),
    'cantidad_anulable', (SELECT count(*) FROM comps WHERE cae IS NULL),
    'pagado_anulable',   COALESCE((SELECT sum(cobrado) FROM comps WHERE cae IS NULL), 0),
    'saldo_pendiente',   COALESCE((SELECT sum(saldo_pendiente) FROM comps), 0)
  ) INTO v_out;
  RETURN v_out;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) TO authenticated;

-- ───────────── #B1/B3/B6 + idempotencia · emisión blindada (DROP+CREATE, +p_forzar) ─────────────
DROP FUNCTION IF EXISTS public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.tramite_emitir_comprobantes_ddjj(
  p_tramite_id uuid,
  p_modo text,
  p_lineas jsonb,
  p_forzar boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid; v_serv uuid; v_estado text;
  v_total int := 0; v_emitidos int := 0; v_errores int := 0;
  v_monto numeric(14,2) := 0; v_detalle jsonb := '[]'::jsonb; v_ids jsonb := '[]'::jsonb;
  v_primero uuid; v_row jsonb; v_idx int := 0;
  v_consorcio uuid; v_tipo_linea text; v_descripcion text;
  v_precio numeric(14,2); v_bonif numeric(5,2); v_alicuota text; v_concepto text;
  v_pv int; v_fecha date; v_venc date; v_obs text; v_comp uuid; v_comp_total numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501'; END IF;
  IF p_modo NOT IN ('unico', 'por_consorcio') THEN RAISE EXCEPTION 'modo inválido (unico|por_consorcio)' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lineas) <> 'array' THEN RAISE EXCEPTION 'p_lineas debe ser un array' USING ERRCODE = '22023'; END IF;

  SELECT administracion_id, servicio_id, estado INTO v_admin, v_serv, v_estado FROM public.tramites WHERE id = p_tramite_id;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Trámite inexistente o sin administración' USING ERRCODE = '22023'; END IF;
  IF v_estado IN ('cerrado', 'cancelado') THEN RAISE EXCEPTION 'El trámite ya está % — no se pueden emitir comprobantes', v_estado USING ERRCODE = '22023'; END IF;
  PERFORM private.assert_administracion_access(v_admin);

  -- Idempotencia: no re-emitir sobre un trámite que ya tiene comprobantes vivos (salvo p_forzar).
  IF NOT p_forzar AND EXISTS (SELECT 1 FROM public.comprobantes c WHERE c.tramite_id = p_tramite_id AND c.estado <> 'anulado') THEN
    RAISE EXCEPTION 'Este trámite ya tiene comprobantes emitidos. Anulá los existentes antes de re-emitir.' USING ERRCODE = '22023';
  END IF;

  v_total := coalesce(jsonb_array_length(p_lineas), 0);
  IF v_total = 0 THEN RAISE EXCEPTION 'No hay líneas para emitir' USING ERRCODE = '22023'; END IF;
  IF p_modo = 'unico' AND v_total > 1 THEN RAISE EXCEPTION 'Modo único: enviá una sola línea' USING ERRCODE = '22023'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_idx := v_idx + 1;
    v_consorcio := NULL;
    BEGIN
      v_tipo_linea := coalesce(nullif(v_row->>'tipo', ''), 'simple');
      IF v_tipo_linea <> 'simple' THEN RAISE EXCEPTION 'Los comprobantes fiscales de DDJJ se habilitan al activar ARCA; por ahora sólo simples'; END IF;
      IF p_modo = 'por_consorcio' THEN
        v_consorcio := nullif(v_row->>'consorcio_id', '')::uuid;
        IF v_consorcio IS NULL THEN RAISE EXCEPTION 'Falta consorcio_id en la línea % (modo por_consorcio)', v_idx; END IF;
      END IF;  -- modo unico: v_consorcio queda NULL (1 comprobante a la admin)

      v_descripcion := nullif(btrim(v_row->>'descripcion'), '');
      IF v_descripcion IS NULL THEN v_descripcion := 'Declaración jurada anual (RPAC)'; END IF;
      v_precio := coalesce(nullif(v_row->>'precio', '')::numeric, 0);
      IF v_precio <= 0 THEN RAISE EXCEPTION 'El precio debe ser mayor a 0 (línea %)', v_idx; END IF;
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
          'descripcion', v_descripcion, 'cantidad', 1, 'precio_unitario', v_precio,
          'bonificacion_porc', v_bonif, 'alicuota_iva', v_alicuota,
          'servicio_id', v_serv, 'consorcio_id', v_consorcio)),
        v_obs, NULL);

      UPDATE public.comprobantes SET tramite_id = p_tramite_id WHERE id = v_comp;
      SELECT total INTO v_comp_total FROM public.comprobantes WHERE id = v_comp;
      v_monto := v_monto + coalesce(v_comp_total, 0);
      v_emitidos := v_emitidos + 1;
      IF v_primero IS NULL THEN v_primero := v_comp; END IF;
      v_ids := v_ids || to_jsonb(v_comp);
      v_detalle := v_detalle || jsonb_build_object('fila', v_idx, 'consorcio_id', v_consorcio, 'comprobante_id', v_comp, 'total', v_comp_total, 'resultado', 'emitido');
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores + 1;
      -- B1: NO re-castear el raw a uuid dentro del handler (relanzaría y abortaría el lote).
      v_detalle := v_detalle || jsonb_build_object('fila', v_idx, 'consorcio_id', v_row->>'consorcio_id', 'resultado', 'error', 'motivo', SQLERRM);
    END;
  END LOOP;

  IF v_primero IS NOT NULL THEN
    UPDATE public.tramites SET comprobante_id = v_primero, ultima_actividad_at = now() WHERE id = p_tramite_id AND comprobante_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'modo', p_modo, 'total_lineas', v_total, 'emitidos', v_emitidos, 'errores', v_errores,
    'monto_total', v_monto, 'primer_comprobante_id', v_primero,
    'comprobante_ids', v_ids, 'detalle', v_detalle);
END;
$$;

REVOKE ALL ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.tramite_emitir_comprobantes_ddjj(uuid, text, jsonb, boolean) IS
  'DGG-275 F3 (fix 0751): emite el lote DDJJ (único/por_consorcio) con guards (array, unico=1 línea, precio>0, idempotencia salvo p_forzar) y aislamiento por fila sin re-cast. Sólo simple. Sólo gerencia.';
