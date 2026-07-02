-- ============================================================================
-- 0269_tramite_cancelar_anula_comprobante_y_cobranza_round.sql
-- DGG-95 (reporte JL 2026-07-02, audio+imágenes):
--
-- (1) Cancelar un trámite era un UPDATE pelado (estado='cancelado') que NO tocaba
--     el comprobante vinculado → al cliente le quedaba una DEUDA en vez de un
--     saldo a favor por lo ya pagado (E-GG-81). Nueva RPC `tramite_cancelar`
--     (decisión de Pablo: "preguntar al cancelar"): si p_anular_comprobante, anula
--     el/los comprobante(s) vinculados NO fiscales (deja lo pagado como saldo a
--     favor, reutilizable con imputar_credito_a_comprobante de JL-3) y OMITE los
--     que tienen CAE (fiscales → nota de crédito; "avisar y frenar"). Luego cancela
--     el trámite. Todo atómico.
--
-- (2) Redondeo defensivo del monto de cobranza a 2 decimales (evita arrastres de
--     centavos que se persistían tal cual — reporte JL del pago $205.000 →
--     $204.999,98; E-GG-82).
-- ============================================================================

-- (1) RPC tramite_cancelar
CREATE OR REPLACE FUNCTION public.tramite_cancelar(
  p_tramite_id uuid,
  p_anular_comprobante boolean DEFAULT false,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    -- Comprobantes vinculados (directo por tramites.comprobante_id + vía solicitud),
    -- NO anulados. Los fiscales (con CAE) se omiten (requieren nota de crédito).
    FOR r IN
      SELECT DISTINCT c.id, c.cae, c.total, c.saldo_pendiente
        FROM public.comprobantes c
       WHERE c.estado <> 'anulado'
         AND ( c.id = v_tramite.comprobante_id
               OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                            WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL) )
    LOOP
      IF r.cae IS NOT NULL THEN
        v_omitidos_cae := array_append(v_omitidos_cae, r.id);
      ELSE
        -- lo pagado (total - saldo) queda como saldo a favor al borrar las imputaciones
        v_saldo_favor := v_saldo_favor + GREATEST(0, COALESCE(r.total,0) - COALESCE(r.saldo_pendiente,0));
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

-- (2) registrar_cobranza_comprobante — redondeo defensivo del monto a 2 decimales
CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid, p_caja_id uuid, p_fecha date, p_monto numeric,
  p_descripcion text, p_referencia text, p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas';
  END IF;
  -- DGG-95: redondeo defensivo a centavos (evita arrastres de float persistidos).
  p_monto := round(p_monto, 2);
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
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
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) del comprobante',
      p_monto, v_comp.saldo_pendiente;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, comprobante_id,
    estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    NULLIF(trim(p_descripcion), ''), NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid(), p_partner_id_atribucion
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, p_monto
  );

  RETURN v_mov_id;
END;
$function$;
