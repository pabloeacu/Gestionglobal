-- 0691 · DGG-250 chunk 1 (datos) · resumen "devengado vs pagado" de una rendición del partner.
--
-- Pablo (2026-11-13): la rendición ahora incluye costos devengados que pueden estar impagos (el
-- partner ve su participación reducida por un costo que GG aún no desembolsó). Para exponerlo con
-- claridad premium y honestidad, la vista/PDF de la rendición mostrarán: de los costos imputados,
-- cuánto YA pagó GG y cuánto queda PENDIENTE de pago — sin alterar la participación (que es devengada).
--
-- Esta RPC calcula ese desglose desde las atribuciones de COSTO de la rendición:
--   · obligaciones (egreso_id): pendiente = egreso.saldo_pendiente ACTUAL (estado de pago vivo),
--     participación-pendiente = saldo × porcentaje; pagado = base − pendiente.
--   · egresos cash standalone (movimiento_id): siempre pagados (la plata ya salió de caja).
-- Devuelve además los totales de la rendición (ingresos/costos atribuidos, neto) para los gráficos.
-- Auth: el partner dueño (current_partner_id) o staff — mismo patrón que partner_sabana.

CREATE OR REPLACE FUNCTION public.partner_rendicion_resumen_pago(p_rendicion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_partner uuid := private.current_partner_id();
  v_rend public.partner_rendiciones%ROWTYPE;
  v_cost_bruto numeric; v_cost_atrib numeric; v_ing_atrib numeric; v_neto numeric;
  v_pend_bruto numeric; v_pend_atrib numeric;
BEGIN
  SELECT * INTO v_rend FROM public.partner_rendiciones WHERE id = p_rendicion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada' USING ERRCODE = 'P0002'; END IF;

  IF v_caller_partner IS NOT NULL THEN
    IF v_caller_partner <> v_rend.partner_id THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  ELSIF NOT private.is_staff() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  v_cost_bruto := COALESCE(v_rend.total_costos_brutos, 0);
  v_cost_atrib := COALESCE(v_rend.total_costos_atribuidos, 0);
  v_ing_atrib  := COALESCE(v_rend.total_ingresos_atribuidos, 0);
  v_neto       := COALESCE(v_rend.neto, 0);

  -- pendiente de pago (GG) sobre las OBLIGACIONES atribuidas en esta rendición, estado de pago ACTUAL
  SELECT
    COALESCE(SUM(eg.saldo_pendiente), 0),
    COALESCE(SUM(ROUND(eg.saldo_pendiente * pa.porcentaje / 100.0, 2)), 0)
    INTO v_pend_bruto, v_pend_atrib
  FROM public.partner_atribuciones pa
  JOIN public.egresos eg ON eg.id = pa.egreso_id
  WHERE pa.rendicion_id = p_rendicion_id AND pa.tipo = 'costo';

  RETURN jsonb_build_object(
    'ingresos_atribuidos',        v_ing_atrib,
    'costos_atribuidos',          v_cost_atrib,
    'costos_brutos',              v_cost_bruto,
    'neto',                       v_neto,
    'costo_pendiente_bruto',      v_pend_bruto,
    'costo_pagado_bruto',         GREATEST(0, v_cost_bruto - v_pend_bruto),
    'costo_pendiente_atribuido',  v_pend_atrib,
    'costo_pagado_atribuido',     GREATEST(0, v_cost_atrib - v_pend_atrib),
    'tiene_pendiente',            (v_pend_bruto > 0)
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.partner_rendicion_resumen_pago(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rendicion_resumen_pago(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.partner_rendicion_resumen_pago(uuid) TO authenticated;
