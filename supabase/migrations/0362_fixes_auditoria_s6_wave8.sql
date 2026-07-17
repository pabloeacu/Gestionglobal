-- 0362 · Fixes de la doble auditoría §6 de la wave 8 (E-GG-142).
--
-- CRÍTICA 1 (seguridad · regresión de 0005a): CREATE OR REPLACE VIEW REEMPLAZA
-- TODAS las reloptions → la vista cajas_con_saldo perdió security_invoker=true
-- en la mig 0360 y volvió a modo DEFINER (owner postgres, bypassa RLS). Probado
-- e2e: un authenticated NO-staff leía nombre+saldo de todas las cajas. LECCIÓN:
-- todo CREATE OR REPLACE VIEW debe re-emitir WITH (security_invoker = true).
--
-- CRÍTICA 2 (contador fantasma): revertir un pendiente_id dejaba
-- movs_pendientes contándolo para siempre (ni cajas_con_saldo ni
-- fz_dashboard_kpis filtraban revertido_at) sin salida posible desde la UI
-- (identificar/anular rechazan revertidos). Fix doble: los contadores filtran
-- revertido_at IS NULL y fz_revertir_movimiento bloquea pendiente_id (el camino
-- correcto para un pendiente erróneo es Anular — no tiene imputaciones).

-- ── 1 · cajas_con_saldo: security_invoker de vuelta + filtro revertido ───────
CREATE OR REPLACE VIEW public.cajas_con_saldo
WITH (security_invoker = true) AS
 SELECT c.id AS caja_id,
    c.nombre,
    c.tipo,
    c.moneda,
    c.color,
    c.icono,
    c.orden,
    c.activo,
    COALESCE(sum(
        CASE
            WHEN m.estado <> 'anulado'::text THEN
            CASE
                WHEN m.tipo = ANY (ARRAY['ingreso'::text, 'transferencia_in'::text]) THEN m.monto
                WHEN m.tipo = ANY (ARRAY['egreso'::text, 'transferencia_out'::text]) THEN - m.monto
                ELSE 0::numeric
            END
            ELSE 0::numeric
        END), 0::numeric) AS saldo,
    count(*) FILTER (WHERE m.estado = 'pendiente_id'::text AND m.revertido_at IS NULL) AS movs_pendientes
   FROM public.cajas c
     LEFT JOIN public.movimientos m ON m.caja_id = c.id
  GROUP BY c.id, c.nombre, c.tipo, c.moneda, c.color, c.icono, c.orden, c.activo;

-- ── 2 · fz_dashboard_kpis: pendientes sin revertidos ─────────────────────────
CREATE OR REPLACE FUNCTION public.fz_dashboard_kpis()
 RETURNS TABLE(saldo_total numeric, ingresos_mes numeric, egresos_mes numeric, movs_pendientes integer, cajas_activas integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    COALESCE((SELECT SUM(saldo) FROM public.cajas_con_saldo WHERE activo), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado <> 'anulado' AND tipo='ingreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado <> 'anulado' AND tipo='egreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    (SELECT COUNT(*)::int FROM public.movimientos
      WHERE estado='pendiente_id' AND revertido_at IS NULL),
    (SELECT COUNT(*)::int FROM public.cajas WHERE activo)
  WHERE private.is_staff();
$$;

-- ── 3 · fz_revertir_movimiento: bloquear pendiente_id ────────────────────────
-- (misma firma → CREATE OR REPLACE seguro R16; sólo se agrega el guard)
CREATE OR REPLACE FUNCTION public.fz_revertir_movimiento(p_movimiento_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mov record; v_par record; v_tipo_reverso text;
  v_nueva_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_ya_revertido' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado = 'anulado' THEN
    RAISE EXCEPTION 'movimiento_anulado_no_se_revierte' USING ERRCODE = '22023';
  END IF;
  -- E-GG-142: un ingreso sin identificar no se revierte (el contrasiento no
  -- aporta nada y el original quedaba contando como pendiente para siempre).
  -- El camino correcto es Anular: un pendiente_id nunca tiene imputaciones.
  IF v_mov.estado = 'pendiente_id' THEN
    RAISE EXCEPTION 'Un ingreso sin identificar no se revierte — usá Anular (no impacta saldo) o identificalo primero.'
      USING ERRCODE = '22023';
  END IF;
  IF v_mov.origen = 'reversion' THEN
    RAISE EXCEPTION 'no_se_puede_revertir_un_contrasiento' USING ERRCODE = '22023';
  END IF;

  -- E-GG-78: si este ingreso tiene saldo a favor aplicado a OTRO comprobante,
  -- revertirlo generaría un contrasiento por el monto total y borraría esa
  -- aplicación. Exigir desimputar esa aplicación primero.
  IF EXISTS (
    SELECT 1 FROM public.movimiento_imputaciones mi
    WHERE mi.movimiento_id = p_movimiento_id
      AND mi.comprobante_id IS NOT NULL
      AND mi.comprobante_id IS DISTINCT FROM v_mov.comprobante_id
  ) THEN
    RAISE EXCEPTION 'Este ingreso tiene saldo a favor aplicado a otro comprobante. Desimputá esa aplicación antes de revertir el movimiento.'
      USING ERRCODE = '22023';
  END IF;

  v_tipo_reverso := CASE v_mov.tipo
    WHEN 'ingreso' THEN 'egreso'
    WHEN 'egreso' THEN 'ingreso'
    WHEN 'transferencia_in' THEN 'transferencia_out'
    WHEN 'transferencia_out' THEN 'transferencia_in'
  END;

  DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen,
    movimiento_revertido_id, created_by
  ) VALUES (
    v_mov.caja_id, CURRENT_DATE, v_tipo_reverso, v_mov.monto,
    'Reversión del ' || to_char(v_mov.fecha, 'DD/MM/YYYY')
      || CASE WHEN p_motivo IS NOT NULL THEN ' · ' || p_motivo ELSE '' END,
    v_mov.referencia, v_mov.administracion_id, v_mov.consorcio_id,
    'identificado', 'reversion', p_movimiento_id, auth.uid()
  )
  RETURNING id INTO v_nueva_id;

  UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = p_movimiento_id;

  IF v_mov.transferencia_pair_id IS NOT NULL THEN
    SELECT * INTO v_par FROM public.movimientos
     WHERE transferencia_pair_id = v_mov.transferencia_pair_id
       AND id <> p_movimiento_id AND revertido_at IS NULL FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.movimiento_imputaciones WHERE movimiento_id = v_par.id;
      v_tipo_reverso := CASE v_par.tipo
        WHEN 'transferencia_in' THEN 'transferencia_out'
        WHEN 'transferencia_out' THEN 'transferencia_in'
        ELSE v_par.tipo
      END;
      INSERT INTO public.movimientos (
        caja_id, fecha, tipo, monto, descripcion, referencia,
        estado, origen, movimiento_revertido_id, created_by
      ) VALUES (
        v_par.caja_id, CURRENT_DATE, v_tipo_reverso, v_par.monto,
        'Reversión de transferencia · pareja', v_par.referencia,
        'identificado', 'reversion', v_par.id, auth.uid()
      );
      UPDATE public.movimientos SET revertido_at = now(), updated_at = now() WHERE id = v_par.id;
    END IF;
  END IF;

  RETURN v_nueva_id;
END;
$function$;

-- ── 4 · fz_desidentificar_movimiento: guard revertido ────────────────────────
CREATE OR REPLACE FUNCTION public.fz_desidentificar_movimiento(p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mov public.movimientos%ROWTYPE;
  v_imps int;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = '22023';
  END IF;
  -- E-GG-142: un movimiento revertido no vuelve a pendiente (dejaría el par de
  -- reversión asimétrico y un fantasma en el contador).
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido' USING ERRCODE = '22023';
  END IF;
  IF v_mov.identificado_at IS NULL OR v_mov.estado <> 'identificado' THEN
    RAISE EXCEPTION 'El movimiento no proviene del flujo de identificación' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_imps FROM public.movimiento_imputaciones WHERE movimiento_id = p_movimiento_id;
  IF v_imps > 0 THEN
    RAISE EXCEPTION 'El movimiento tiene % aplicación(es) a comprobantes — quitá primero el saldo aplicado desde la cuenta corriente', v_imps
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.movimientos
     SET administracion_id = NULL,
         partner_id_atribucion = NULL,
         estado = 'pendiente_id',
         identificado_at = NULL,
         identificado_by = NULL
   WHERE id = p_movimiento_id;
END;
$$;

-- ── 5 · fz_crear_movimiento_manual: la guarda sin_identificar bloquea también
--        consorcio (un ingreso "sin cliente" no puede arrastrar el consorcio de
--        un cliente concreto). Misma firma de 12 params → CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.fz_crear_movimiento_manual(
  p_caja_id uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_categoria_id uuid DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL,
  p_consorcio_id uuid DEFAULT NULL,
  p_comprobante_imputar_a_id uuid DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL,
  p_sin_identificar boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mov_id uuid;
  v_comp_saldo numeric;
  v_comp_estado text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_tipo NOT IN ('ingreso','egreso') THEN RAISE EXCEPTION 'tipo_invalido' USING ERRCODE = '22023'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'monto_invalido' USING ERRCODE = '22023'; END IF;
  IF p_fecha IS NULL THEN RAISE EXCEPTION 'fecha_requerida' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
    RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  IF p_comprobante_imputar_a_id IS NOT NULL AND p_tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_imputan_a_comprobantes' USING ERRCODE = '22023';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  IF p_sin_identificar THEN
    IF p_tipo <> 'ingreso' THEN
      RAISE EXCEPTION 'solo_ingresos_pueden_quedar_sin_identificar' USING ERRCODE = '22023';
    END IF;
    IF p_administracion_id IS NOT NULL OR p_consorcio_id IS NOT NULL
       OR p_comprobante_imputar_a_id IS NOT NULL OR p_partner_id_atribucion IS NOT NULL THEN
      RAISE EXCEPTION 'sin_identificar_incompatible_con_cliente_imputacion_o_partner' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    SELECT saldo_pendiente, estado INTO v_comp_saldo, v_comp_estado
      FROM public.comprobantes WHERE id = p_comprobante_imputar_a_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'comprobante_a_imputar_inexistente' USING ERRCODE = '22023';
    END IF;
    IF v_comp_estado = 'anulado' THEN
      RAISE EXCEPTION 'comprobante_anulado_no_admite_imputacion' USING ERRCODE = '22023';
    END IF;
    IF p_monto > COALESCE(v_comp_saldo, 0) + 0.001 THEN
      RAISE EXCEPTION 'El monto (%) supera el saldo del comprobante (%)', p_monto, v_comp_saldo
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, p_tipo, p_monto, p_categoria_id, p_descripcion, p_referencia,
    p_administracion_id, p_consorcio_id,
    CASE WHEN p_sin_identificar THEN 'pendiente_id' ELSE 'identificado' END,
    'manual', auth.uid(), p_partner_id_atribucion
  )
  RETURNING id INTO v_mov_id;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    INSERT INTO public.movimiento_imputaciones (movimiento_id, comprobante_id, monto_imputado)
    VALUES (v_mov_id, p_comprobante_imputar_a_id, p_monto);
  END IF;

  RETURN v_mov_id;
END;
$$;

-- ── 6 · Conciliación bancaria reconoce pendientes ────────────────────────────
-- El caso núcleo de JL (crédito bancario de origen desconocido) es exactamente
-- lo que aparece en el extracto importado: la línea del banco debe poder
-- matchear/conciliarse contra el movimiento pendiente (la plata ES la misma).
CREATE OR REPLACE FUNCTION public.fz_conciliar_manual(p_historico_id uuid, p_movimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hist record; v_mov record;
  v_monto_hist numeric; v_tipo_hist text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_hist FROM public.historico_banco WHERE id = p_historico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'historico_inexistente' USING ERRCODE='P0002'; END IF;
  IF v_hist.conciliado_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_conciliado' USING ERRCODE='22023'; END IF;
  IF v_hist.ignorada_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_ignorado' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE='P0002'; END IF;
  IF v_mov.caja_id <> v_hist.caja_id THEN RAISE EXCEPTION 'caja_no_coincide' USING ERRCODE='22023'; END IF;
  -- E-GG-142: los pendiente_id también son conciliables (la plata está en caja)
  IF v_mov.estado NOT IN ('identificado','pendiente_id') OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_no_valido' USING ERRCODE='22023';
  END IF;

  IF v_hist.ingreso > 0 THEN v_tipo_hist := 'ingreso'; v_monto_hist := v_hist.ingreso;
  ELSE v_tipo_hist := 'egreso'; v_monto_hist := v_hist.egreso; END IF;
  IF v_mov.tipo <> v_tipo_hist OR v_mov.monto <> v_monto_hist THEN
    RAISE EXCEPTION 'tipo_o_monto_no_coincide' USING ERRCODE='22023';
  END IF;

  UPDATE public.historico_banco
     SET movimiento_id = p_movimiento_id, conciliado_at = now()
   WHERE id = p_historico_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fz_sugerir_matches(p_historico_id uuid)
 RETURNS TABLE(movimiento_id uuid, fecha date, tipo text, monto numeric, descripcion text, categoria_nombre text, administracion_nombre text, dias_diff integer, score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hist record; v_tipo_buscar text; v_monto numeric;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_hist FROM public.historico_banco WHERE id = p_historico_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_hist.ingreso > 0 THEN v_tipo_buscar := 'ingreso'; v_monto := v_hist.ingreso;
  ELSE v_tipo_buscar := 'egreso'; v_monto := v_hist.egreso; END IF;

  RETURN QUERY
  SELECT m.id, m.fecha, m.tipo, m.monto, m.descripcion,
    cat.nombre, a.nombre,
    ABS((m.fecha - v_hist.fecha)::int) AS dias_diff,
    GREATEST(0, 100 - ABS((m.fecha - v_hist.fecha)::int) * 5)::numeric AS score
  FROM public.movimientos m
  LEFT JOIN public.categorias_finanzas cat ON cat.id = m.categoria_id
  LEFT JOIN public.administraciones a ON a.id = m.administracion_id
  WHERE m.caja_id = v_hist.caja_id
    AND m.tipo = v_tipo_buscar AND m.monto = v_monto
    -- E-GG-142: los pendiente_id también son matches válidos
    AND m.estado IN ('identificado','pendiente_id') AND m.revertido_at IS NULL
    AND m.origen <> 'reversion'
    AND ABS((m.fecha - v_hist.fecha)::int) <= 5
    AND NOT EXISTS (SELECT 1 FROM public.historico_banco hb
                    WHERE hb.movimiento_id = m.id AND hb.id <> p_historico_id)
  ORDER BY dias_diff ASC, m.fecha DESC LIMIT 10;
END;
$function$;
