-- ============================================================================
-- 0418 · §6 E-GG-178 — Dos hallazgos confirmados de la auditoría del chunk
--
-- 1. fz_identificar_movimiento (W8-3), rama CLIENTE: si el movimiento nació
--    sin descripción (NuevoMovimientoModal manda null) y gerencia identifica
--    sin tipear nada (el modal de identificación en modo cliente NI TIENE el
--    campo), el asiento quedaba NULL → "Sin descripción" en la caja y
--    "Cobranza" pelado en el extracto del cliente. Misma familia que el caso
--    Drozd por otra puerta. Fix: fallback compuesto — 'Cobranza · <renglón>'
--    si hay comprobante (mismo default que mig 0416), 'Cobranza · X 0001-…'
--    sin renglones, 'Pago identificado' si ni comprobante hay (saldo a favor).
--
-- 2. cuenta_corriente_extracto: la regexp de 0417 ('^[Cc]obranza\s*·\s*')
--    solo despeja el prefijo CON interpunto — 'Cobranza desde solicitud' o
--    'Cobranza recibo 12' seguirían duplicando. Se endurece a
--    '^[Cc]obranza(\s*·\s*|\s+|$)': cubre interpunto, espacio y la palabra
--    exacta, sin tocar palabras que solo EMPIEZAN igual ('Cobranzas varias'
--    no matchea — la 's' no es ·, espacio ni fin).
--
-- R16: ambas firmas idénticas → CREATE OR REPLACE sin overloads (smoke al
-- cierre). R18: smoke e2e ejecutando fz_identificar_movimiento real.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fz_identificar_movimiento(p_movimiento_id uuid, p_administracion_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_monto_imputar numeric DEFAULT NULL::numeric, p_partner_id_atribucion uuid DEFAULT NULL::uuid, p_categoria_id uuid DEFAULT NULL::uuid, p_descripcion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mov public.movimientos%ROWTYPE;
  v_comp_saldo numeric;
  v_monto numeric;
  v_imputado numeric := 0;
  v_cat_tipo text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_mov.tipo <> 'ingreso' THEN
    RAISE EXCEPTION 'solo_ingresos_se_identifican' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado <> 'pendiente_id' THEN
    RAISE EXCEPTION 'El movimiento no está pendiente de identificar (estado %)', v_mov.estado
      USING ERRCODE = '22023';
  END IF;
  IF v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_revertido' USING ERRCODE = '22023';
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    SELECT tipo INTO v_cat_tipo FROM public.categorias_finanzas WHERE id = p_categoria_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'categoria_inexistente' USING ERRCODE = '22023';
    END IF;
    IF v_cat_tipo NOT IN ('ingreso','ambos') THEN
      RAISE EXCEPTION 'La categoría elegida no es de ingresos' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_administracion_id IS NULL THEN
    IF p_comprobante_id IS NOT NULL OR p_monto_imputar IS NOT NULL
       OR p_partner_id_atribucion IS NOT NULL THEN
      RAISE EXCEPTION 'Un ingreso sin cliente no admite comprobante ni partner' USING ERRCODE = '22023';
    END IF;
    IF p_categoria_id IS NULL AND NULLIF(trim(COALESCE(p_descripcion, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Indicá la categoría o una descripción del ingreso para identificarlo' USING ERRCODE = '22023';
    END IF;
    UPDATE public.movimientos
       SET categoria_id = COALESCE(p_categoria_id, categoria_id),
           descripcion = COALESCE(NULLIF(trim(p_descripcion), ''), descripcion),
           estado = 'identificado',
           identificado_at = now(),
           identificado_by = auth.uid()
     WHERE id = p_movimiento_id;
    RETURN jsonb_build_object(
      'movimiento_id', p_movimiento_id,
      'modo', 'casa',
      'administracion_id', NULL,
      'imputado', 0,
      'saldo_a_favor_restante', 0
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'administracion_inexistente' USING ERRCODE = '22023';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  UPDATE public.movimientos
     SET administracion_id = p_administracion_id,
         partner_id_atribucion = COALESCE(p_partner_id_atribucion, partner_id_atribucion),
         categoria_id = COALESCE(p_categoria_id, categoria_id),
         -- 0418 (§6 E-GG-178): el modal de identificación en modo cliente no
         -- tiene campo descripción — si el movimiento nació NULL, se compone
         -- el mismo default que la RPC de cobranza (mig 0416).
         descripcion = COALESCE(
           NULLIF(trim(p_descripcion), ''),
           descripcion,
           CASE WHEN p_comprobante_id IS NOT NULL THEN (
             SELECT 'Cobranza · ' || i.descripcion
             FROM public.items_comprobantes i
             WHERE i.comprobante_id = p_comprobante_id
               AND NULLIF(trim(i.descripcion), '') IS NOT NULL
             ORDER BY i.orden ASC, i.created_at ASC LIMIT 1
           ) END,
           CASE WHEN p_comprobante_id IS NOT NULL THEN (
             SELECT 'Cobranza · ' || c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0')
                    || '-' || COALESCE(lpad(c.numero::text, 8, '0'), 's/n')
             FROM public.comprobantes c WHERE c.id = p_comprobante_id
           ) END,
           'Pago identificado'
         ),
         estado = 'identificado',
         identificado_at = now(),
         identificado_by = auth.uid()
   WHERE id = p_movimiento_id;

  IF p_comprobante_id IS NOT NULL THEN
    SELECT saldo_pendiente INTO v_comp_saldo
      FROM public.comprobantes WHERE id = p_comprobante_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'comprobante_inexistente' USING ERRCODE = '22023';
    END IF;
    v_monto := COALESCE(p_monto_imputar, LEAST(v_mov.monto, COALESCE(v_comp_saldo, 0)));
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'El comprobante no tiene saldo pendiente para aplicar' USING ERRCODE = '22023';
    END IF;
    PERFORM public.imputar_credito_a_comprobante(p_movimiento_id, p_comprobante_id, v_monto);
    v_imputado := v_monto;
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', p_movimiento_id,
    'modo', 'cliente',
    'administracion_id', p_administracion_id,
    'imputado', v_imputado,
    'saldo_a_favor_restante', v_mov.monto
      - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                   WHERE mi.movimiento_id = p_movimiento_id), 0)
  );
END;
$function$;

-- (2) Endurecer la regexp del extracto: '^[Cc]obranza(\s*·\s*|\s+|$)' en las
-- dos composiciones (abono y saldo_favor). Se reemplaza la función completa
-- con el patrón nuevo — cuerpo idéntico al de mig 0417 salvo las dos regexp.

CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(p_administracion_id uuid, p_desde date, p_hasta date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric, saldo numeric, comprobante_id uuid, movimiento_id uuid, imputacion_id uuid, consorcio_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_saldo_inicial numeric;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

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
    SELECT
      c.fecha AS b_fecha, 'cargo'::text AS b_tipo, 0::int AS b_tipo_ord,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0') ELSE '' END
        || CASE WHEN det.detalle IS NOT NULL THEN ' · ' || det.detalle ELSE '' END
      ) AS b_descripcion,
      c.total::numeric AS b_debe, 0::numeric AS b_haber,
      c.id AS b_comprobante_id, NULL::uuid AS b_movimiento_id,
      NULL::uuid AS b_imputacion_id, cons.nombre AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
      ) x
    ) det ON true
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.fecha BETWEEN p_desde AND p_hasta

    UNION ALL

    SELECT
      m.fecha, 'abono'::text, 1::int,
      (
        'Cobranza'
        -- E-GG-178: si la descripción ya viene como "Cobranza · X", se
        -- muestra "Cobranza · X" y no "Cobranza · Cobranza · X".
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza(\s*·\s*|\s+|$)', ''), ''), '')
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

    SELECT
      m.fecha, 'saldo_favor'::text, 2::int,
      (
        'Saldo a favor'
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza(\s*·\s*|\s+|$)', ''), ''), ' · pago no imputado')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
        || COALESCE(' · origen: ' || ori.detalle, '')
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
    LEFT JOIN LATERAL (
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
          FROM public.comprobantes c
         WHERE c.id = m.comprobante_id
           AND c.administracion_id = p_administracion_id
      ) x
    ) ori ON true
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
