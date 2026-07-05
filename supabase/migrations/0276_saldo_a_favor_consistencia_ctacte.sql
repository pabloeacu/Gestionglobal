-- 0276 · E-GG-86 · Consistencia financiera integral: saldo a favor visible + blindaje
-- ============================================================================
-- CONTEXTO (reporte JL · caso X-00000037 "Est Sav", $360.000, anulado):
--   "Se anuló el comprobante pero el dinero ingresado no figura en ningún lado.
--    En la caja está, pero en la Cta. Cte. del cliente no lo veo."
--
-- CAUSA RAÍZ (auditoría doble §6, 4 agentes + e2e en BD):
--   `movimiento_imputaciones` se usa como "libro de cobranzas" para armar la
--   cuenta corriente (el HABER sale de las imputaciones). Pero `anular_comprobante`
--   BORRA físicamente las imputaciones del comprobante → el ingreso queda como
--   crédito huérfano (saldo a favor) que NINGUNA superficie de cta cte muestra,
--   aunque sí está en la caja y en `listar_creditos_administracion`.
--   3 vías equivalentes producen saldo a favor invisible:
--     (a) anular un comprobante ya pagado,
--     (b) pago a cuenta (imputación a administracion_id),
--     (c) residual de una cobranza parcial (ingreso > saldo del comprobante).
--
-- DECISIÓN (Pablo, opción no destructiva): NO se cambia el comportamiento de
--   `anular_comprobante` (el ingreso sigue quedando como crédito). Se lo hace
--   VISIBLE de forma consistente en toda la cta cte, como un HABER "Saldo a favor".
--   El crédito se sigue aplicando con `imputar_credito_a_comprobante` (JL-3).
--   `observado`/`compensado` SIGUEN sumando como deuda (criterio contable de Pablo:
--   el compensado se empata con su nota de crédito de signo contrario; el observado
--   es deuda real sin comprobante fiscal). => NO se toca el filtro de estado.
--
-- QUÉ HACE ESTA MIGRACIÓN (una sola fuente de verdad):
--   §1 cuenta_corriente_extracto  → 3ª rama HABER "Saldo a favor" (ingreso vivo con
--        residual) + saldo_inicial que netea el crédito previo + filtro revertido_at.
--   §2 cuenta_corriente_resumen   → nuevo campo saldo_a_favor + saldo_actual neteado.
--   §3 cuenta_corriente_resumen_global → nuevo campo saldo_a_favor por administración.
--   §4 BLINDAJE estructural: trigger simétrico Σ(imputaciones por comprobante) ≤ total
--        (hoy sólo existe el del lado movimiento). Atrapa de raíz #8 y #9.
--   §5 BLINDAJE: imputar_credito_a_comprobante toma FOR UPDATE del comprobante destino
--        (race de dos créditos concurrentes al mismo comprobante enmascarada por clamp).
--   §6 BLINDAJE: fz_crear_movimiento_manual valida saldo/estado antes de imputar
--        (hoy imputa sin ningún chequeo — foot-gun latente).
--
-- Reglas: R1, R2, R5, R6 (GRANT explícito), R11 (índices ya existen), R16
--   (DROP+CREATE en §2/§3 porque cambia la firma de retorno; smoke de overloads
--   al final del chunk), R19 (KPIs sobre universo completo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1 · cuenta_corriente_extracto: saldo a favor visible + saldo inicial neteado
--     (misma firma de retorno → CREATE OR REPLACE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(
  p_administracion_id uuid, p_desde date, p_hasta date
)
RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric,
              saldo numeric, comprobante_id uuid, movimiento_id uuid,
              imputacion_id uuid, consorcio_nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_saldo_inicial numeric;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  -- Saldo inicial = (cargos previos) − (cobranzas imputadas previas)
  --                 − (saldo a favor previo = residual de ingresos vivos previos).
  -- Sin el tercer término, un crédito nacido antes del rango quedaba fuera del
  -- arrastre y el saldo se veía inflado (deuda fantasma).
  SELECT
    COALESCE((
      SELECT SUM(c.total)
        FROM public.comprobantes c
       WHERE c.administracion_id = p_administracion_id
         AND c.estado NOT IN ('anulado','borrador')
         AND c.fecha < p_desde
    ), 0)
    - COALESCE((
      SELECT SUM(mi.monto_imputado)
        FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
        JOIN public.comprobantes c ON c.id = mi.comprobante_id
       WHERE c.administracion_id = p_administracion_id
         AND m.fecha < p_desde
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
    ), 0)
    - COALESCE((
      SELECT SUM(m.monto - COALESCE(imp.aplicado, 0))
        FROM public.movimientos m
        LEFT JOIN LATERAL (
          SELECT SUM(mi.monto_imputado) AS aplicado
            FROM public.movimiento_imputaciones mi
           WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
        ) imp ON true
       WHERE m.administracion_id = p_administracion_id
         AND m.tipo = 'ingreso'
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
         AND m.fecha < p_desde
         AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    ), 0)
  INTO v_saldo_inicial;

  RETURN QUERY
  WITH base AS (
    -- CARGO: comprobantes (deuda)
    SELECT
      c.fecha AS b_fecha, 'cargo'::text AS b_tipo, 0::int AS b_tipo_ord,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0') ELSE '' END
        || CASE WHEN c.concepto IS NOT NULL THEN ' · ' || c.concepto ELSE '' END
      ) AS b_descripcion,
      c.total::numeric AS b_debe, 0::numeric AS b_haber,
      c.id AS b_comprobante_id, NULL::uuid AS b_movimiento_id,
      NULL::uuid AS b_imputacion_id, cons.nombre AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta

    UNION ALL

    -- ABONO: cobranzas imputadas a un comprobante (no cuenta reversiones)
    SELECT
      m.fecha, 'abono'::text, 1::int,
      (
        'Cobranza'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), '')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
      ),
      0::numeric, mi.monto_imputado::numeric,
      c.id, m.id, mi.id, cons.nombre, m.created_at::timestamptz
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL

    UNION ALL

    -- SALDO A FAVOR: porción de un ingreso vivo NO imputada a comprobante
    -- (residual + pago a cuenta). Es el HABER que faltaba: dinero del cliente
    -- que no está reduciendo ninguna deuda puntual. Una fila por movimiento.
    SELECT
      m.fecha, 'saldo_favor'::text, 2::int,
      (
        'Saldo a favor'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), ' · pago no imputado')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
      ),
      0::numeric,
      (m.monto - COALESCE(imp.aplicado, 0))::numeric,
      NULL::uuid, m.id, NULL::uuid, NULL::text, m.created_at::timestamptz
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado
        FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo = 'ingreso'
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  ordered AS (
    SELECT base.*,
      row_number() OVER (ORDER BY base.b_fecha ASC, base.b_tipo_ord ASC, base.b_ord ASC) AS rn
    FROM base
  ),
  final_q AS (
    SELECT
      p_desde AS f_fecha, 'saldo_inicial'::text AS f_tipo,
      'Saldo anterior'::text AS f_descripcion,
      0::numeric AS f_debe, 0::numeric AS f_haber, v_saldo_inicial AS f_saldo,
      NULL::uuid AS f_comprobante_id, NULL::uuid AS f_movimiento_id,
      NULL::uuid AS f_imputacion_id, NULL::text AS f_consorcio_nombre,
      0::bigint AS f_sort
    UNION ALL
    SELECT
      o.b_fecha, o.b_tipo, o.b_descripcion, o.b_debe, o.b_haber,
      v_saldo_inicial + SUM(o.b_debe - o.b_haber) OVER (ORDER BY o.rn),
      o.b_comprobante_id, o.b_movimiento_id, o.b_imputacion_id,
      o.b_consorcio_nombre, o.rn::bigint
    FROM ordered o
  )
  SELECT f_fecha, f_tipo, f_descripcion, f_debe, f_haber, f_saldo,
         f_comprobante_id, f_movimiento_id, f_imputacion_id, f_consorcio_nombre
  FROM final_q
  ORDER BY f_sort ASC;
END;
$function$;

-- ----------------------------------------------------------------------------
-- §2 · cuenta_corriente_resumen: nuevo campo saldo_a_favor + saldo_actual neteado
--     (cambia la firma de retorno → DROP + CREATE · R16)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cuenta_corriente_resumen(uuid, date, date);
CREATE FUNCTION public.cuenta_corriente_resumen(
  p_administracion_id uuid,
  p_desde date DEFAULT ((CURRENT_DATE - '1 year'::interval))::date,
  p_hasta date DEFAULT CURRENT_DATE
)
RETURNS TABLE(saldo_inicial numeric, total_facturado numeric, total_cobrado numeric,
              saldo_actual numeric, comprobantes_pendientes integer,
              comprobantes_vencidos integer, deuda_total numeric,
              saldo_a_favor numeric, proximo_vencimiento date)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  RETURN QUERY
  WITH
  cargos_prev AS (
    SELECT COALESCE(SUM(total), 0) AS x FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha < p_desde
  ),
  abonos_prev AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha < p_desde AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  -- saldo a favor generado por ingresos previos al rango (residual no imputado)
  credito_prev AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha < p_desde AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  cargos_rango AS (
    SELECT COALESCE(SUM(total), 0) AS x FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha BETWEEN p_desde AND p_hasta
  ),
  abonos_rango AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  -- saldo a favor generado dentro del rango
  credito_rango AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  -- saldo a favor VIGENTE (todos los ingresos vivos, sin cota de fecha) = lo que
  -- muestra listar_creditos_administracion. Punto en el tiempo, como deuda_total.
  credito_actual AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  saldos_actuales AS (
    SELECT
      COALESCE(SUM(saldo_pendiente), 0) AS deuda_total,
      COUNT(*) FILTER (WHERE estado_cobranza IN ('pendiente','parcial'))::int AS pendientes,
      COUNT(*) FILTER (WHERE estado_cobranza = 'vencido')::int AS vencidos,
      MIN(vencimiento) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial') AND vencimiento >= current_date
      ) AS proximo
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id AND estado NOT IN ('anulado','borrador')
  )
  SELECT
    (cargos_prev.x - abonos_prev.x - credito_prev.x)         AS saldo_inicial,
    cargos_rango.x                                           AS total_facturado,
    abonos_rango.x                                           AS total_cobrado,
    -- saldo_actual = posición neta a p_hasta = (todos los cargos) − (todo el dinero).
    -- Puede ser negativo (acreedor / a favor del cliente). La UI ya lo interpreta.
    (cargos_prev.x - abonos_prev.x - credito_prev.x
      + cargos_rango.x - abonos_rango.x - credito_rango.x)   AS saldo_actual,
    saldos_actuales.pendientes,
    saldos_actuales.vencidos,
    saldos_actuales.deuda_total,
    credito_actual.x                                         AS saldo_a_favor,
    saldos_actuales.proximo
  FROM cargos_prev, abonos_prev, credito_prev, cargos_rango, abonos_rango,
       credito_rango, credito_actual, saldos_actuales;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_resumen(uuid, date, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- §3 · cuenta_corriente_resumen_global: saldo_a_favor por administración
--     (cambia firma de retorno → DROP + CREATE · R16)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cuenta_corriente_resumen_global(date, date);
CREATE FUNCTION public.cuenta_corriente_resumen_global(
  p_desde date DEFAULT ((CURRENT_DATE - '1 year'::interval))::date,
  p_hasta date DEFAULT CURRENT_DATE
)
RETURNS TABLE(administracion_id uuid, administracion_nombre text,
              total_facturado numeric, total_cobrado numeric, deuda_total numeric,
              saldo_a_favor numeric, comprobantes_vencidos integer,
              comprobantes_pendientes integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar el resumen global';
  END IF;

  RETURN QUERY
  WITH cargos AS (
    SELECT c.administracion_id AS aid, SUM(c.total) AS x
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador') AND c.fecha BETWEEN p_desde AND p_hasta
    GROUP BY c.administracion_id
  ),
  abonos AS (
    SELECT c.administracion_id AS aid, SUM(mi.monto_imputado) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
    GROUP BY c.administracion_id
  ),
  -- saldo a favor vigente por administración
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado, 0)) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    GROUP BY m.administracion_id
  ),
  deudas AS (
    SELECT c.administracion_id AS aid, SUM(c.saldo_pendiente) AS deuda,
      COUNT(*) FILTER (WHERE c.estado_cobranza = 'vencido')::int AS vencidos,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pendientes
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador')
    GROUP BY c.administracion_id
  )
  SELECT
    a.id, a.nombre,
    COALESCE(cargos.x, 0)::numeric, COALESCE(abonos.x, 0)::numeric,
    COALESCE(deudas.deuda, 0)::numeric, COALESCE(creditos.x, 0)::numeric,
    COALESCE(deudas.vencidos, 0), COALESCE(deudas.pendientes, 0)
  FROM public.administraciones a
  LEFT JOIN cargos ON cargos.aid = a.id
  LEFT JOIN abonos ON abonos.aid = a.id
  LEFT JOIN creditos ON creditos.aid = a.id
  LEFT JOIN deudas ON deudas.aid = a.id
  WHERE a.activo = true
    AND (COALESCE(cargos.x, 0) > 0 OR COALESCE(abonos.x, 0) > 0
         OR COALESCE(deudas.deuda, 0) > 0 OR COALESCE(creditos.x, 0) > 0)
  ORDER BY COALESCE(deudas.deuda, 0) DESC, a.nombre ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.cuenta_corriente_resumen_global(date, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- §4 · BLINDAJE estructural: Σ(imputaciones por comprobante) ≤ total
--     Simétrico a trg_imp_validar_sum_no_supera_monto (lado movimiento, ya existe).
--     Atrapa de raíz: over-imputación por fz_crear_movimiento_manual (#8) y por
--     carreras de aplicación de crédito (#9). El clamp GREATEST(0,…) del trigger
--     de recálculo enmascaraba el desbalance; este freno lo hace imposible.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_imp_validar_sum_no_supera_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sum_otros numeric;
  v_total     numeric;
BEGIN
  -- Sólo aplica a imputaciones con destino comprobante. Las de pago a cuenta
  -- (administracion_id) no tienen tope de comprobante.
  IF NEW.comprobante_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT total INTO v_total FROM public.comprobantes WHERE id = NEW.comprobante_id;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'comprobante_inexistente_para_imputacion' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_sum_otros
    FROM public.movimiento_imputaciones
   WHERE comprobante_id = NEW.comprobante_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_sum_otros + NEW.monto_imputado) > v_total + 0.001 THEN
    RAISE EXCEPTION
      'La suma de pagos imputados (%) supera el total del comprobante (%)',
      v_sum_otros + NEW.monto_imputado, v_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_imp_validar_sum_total ON public.movimiento_imputaciones;
CREATE TRIGGER trg_imp_validar_sum_total
  BEFORE INSERT OR UPDATE OF monto_imputado, comprobante_id
  ON public.movimiento_imputaciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_imp_validar_sum_no_supera_total();

-- ----------------------------------------------------------------------------
-- §5 · BLINDAJE: imputar_credito_a_comprobante toma FOR UPDATE del comprobante
--     destino (evita que dos créditos concurrentes lean el mismo saldo y
--     sobre-apliquen). Sólo se agrega el lock; el resto de la lógica intacta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.imputar_credito_a_comprobante(
  p_movimiento_id uuid, p_comprobante_id uuid, p_monto numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_mov public.movimientos%ROWTYPE;
  v_comp public.comprobantes%ROWTYPE;
  v_saldo_credito numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

  -- FOR UPDATE: serializa dos aplicaciones concurrentes del mismo crédito.
  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor no existe'; END IF;
  IF v_mov.tipo <> 'ingreso' OR v_mov.estado <> 'identificado' OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento no es un ingreso disponible';
  END IF;

  -- FOR UPDATE también sobre el comprobante destino: sin esto, dos créditos
  -- distintos aplicados al mismo comprobante leían el mismo saldo y lo
  -- sobre-aplicaban (el clamp del recálculo lo escondía). (E-GG-86 · Audit B #9)
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El comprobante no existe'; END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'El comprobante está anulado'; END IF;
  IF COALESCE(v_comp.saldo_pendiente, 0) <= 0 THEN RAISE EXCEPTION 'El comprobante no tiene saldo pendiente'; END IF;

  IF v_mov.administracion_id IS DISTINCT FROM v_comp.administracion_id THEN
    RAISE EXCEPTION 'El saldo a favor y el comprobante pertenecen a administraciones distintas';
  END IF;

  v_saldo_credito := v_mov.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                                              WHERE mi.movimiento_id = p_movimiento_id), 0);
  IF v_saldo_credito <= 0 THEN RAISE EXCEPTION 'Ese saldo a favor ya fue aplicado'; END IF;
  IF p_monto > v_saldo_credito THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo a favor disponible (%)', p_monto, v_saldo_credito;
  END IF;
  IF p_monto > v_comp.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo del comprobante (%)', p_monto, v_comp.saldo_pendiente;
  END IF;

  INSERT INTO public.movimiento_imputaciones
    (movimiento_id, comprobante_id, administracion_id, monto_imputado, nota, created_by)
  VALUES (p_movimiento_id, p_comprobante_id, NULL, p_monto,
          'Saldo a favor aplicado (crédito por anulación/pago a cuenta)', v_user);

  RETURN jsonb_build_object('ok', true,
    'credito_restante', v_saldo_credito - p_monto,
    'comprobante_saldo', (SELECT saldo_pendiente FROM public.comprobantes WHERE id = p_comprobante_id));
END;
$function$;

-- ----------------------------------------------------------------------------
-- §6 · BLINDAJE: fz_crear_movimiento_manual valida el comprobante destino antes
--     de imputar (hoy INSERTA la imputación sin chequear saldo/estado — foot-gun
--     latente: sólo no explota porque la UI actual no pasa el parámetro).
--     Misma firma (11 params) → CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_crear_movimiento_manual(
  p_caja_id uuid, p_tipo text, p_monto numeric, p_fecha date,
  p_categoria_id uuid DEFAULT NULL::uuid, p_descripcion text DEFAULT NULL::text,
  p_referencia text DEFAULT NULL::text, p_administracion_id uuid DEFAULT NULL::uuid,
  p_consorcio_id uuid DEFAULT NULL::uuid, p_comprobante_imputar_a_id uuid DEFAULT NULL::uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Validación del comprobante destino ANTES de crear nada (E-GG-86 · Audit B #8).
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
    p_administracion_id, p_consorcio_id, 'identificado', 'manual', auth.uid(),
    p_partner_id_atribucion
  )
  RETURNING id INTO v_mov_id;

  IF p_comprobante_imputar_a_id IS NOT NULL THEN
    INSERT INTO public.movimiento_imputaciones (movimiento_id, comprobante_id, monto_imputado)
    VALUES (v_mov_id, p_comprobante_imputar_a_id, p_monto);
  END IF;

  RETURN v_mov_id;
END;
$function$;
