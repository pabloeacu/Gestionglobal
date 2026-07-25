-- ============================================================================
-- 0386 · Cierre de auditoría §6 de E-GG-159 + E-GG-160
--
-- (A) E-GG-159 — refinamientos de la cascada canónica de descripción en
--     `cuenta_corriente_extracto` (hallazgos de la doble auditoría sobre 0385):
--     · Items: string_agg dedupeado (GROUP BY descripción trimmeada, orden
--       estable por MIN(orden)) y con '' / '   ' filtrados. Antes, un item con
--       descripción vacía hacía que string_agg devolviera '' (no NULL), la
--       COALESCE no caía al siguiente escalón y quedaba "X 00001-… · " colgante.
--     · trim + NULLIF en TODOS los escalones (servicio, items, trámite,
--       concepto) y en el resultado final.
--     · Trámites: ORDER BY determinístico (created_at, id) + coherencia de
--       tenencia (t.administracion_id NULL o = la del comprobante).
--     · Lateral "ori" (origen del saldo a favor): guard explícito
--       c.administracion_id = p_administracion_id.
--     · Truncado con elipsis visible ('…') en vez de corte seco a 160.
--     Firma y RETURNS idénticos a 0385/0359 → CREATE OR REPLACE sin overload
--     (R16 no aplica; smoke de overloads igual en el cierre).
--
-- (B) E-GG-160 — `partner_rendicion_movimientos` estaba ROTA desde su origen
--     (0118, arrastrado a 0250): joineaba `public.comprobante_items`, tabla
--     que JAMÁS existió (la real es `items_comprobantes`, mig 0004). plpgsql
--     compila cada statement recién al ejecutarlo (lección E-GG-42 / R18), y
--     el guard "solo partner o staff" corta ANTES del statement roto para
--     staff → nunca explotó porque HOY no existe ningún usuario con rol
--     partner (0 profiles con partner_id). Evidencia pre-fix ejercitada:
--     42P01 `relation "public.comprobante_items" does not exist` al ejecutar
--     con un perfil partner. Fix: reemplazar el join items+servicios (que
--     además multiplicaba filas por item y "elegía" un servicio alfabético
--     vía DISTINCT ON) por la MISMA cascada canónica del extracto → una fila
--     por atribución y la única fuente de verdad del servicio contratado
--     (canon E-GG-159). Firma idéntica → sin overload.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) cuenta_corriente_extracto — cascada refinada en ambos laterales
-- ----------------------------------------------------------------------------
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
        -- E-GG-159: QUÉ se contrató (cascada canónica), no el concepto fiscal.
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

    SELECT
      m.fecha, 'saldo_favor'::text, 2::int,
      (
        'Saldo a favor'
        || COALESCE(' · ' || NULLIF(trim(m.descripcion), ''), ' · pago no imputado')
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

-- ----------------------------------------------------------------------------
-- (B) partner_rendicion_movimientos — reparación E-GG-160
--     `comprobante_items` (fantasma) → cascada canónica sobre tablas reales.
--     Sin el join multiplicador, el DISTINCT ON queda como red de seguridad.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rendicion_movimientos(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(atribucion_id uuid, fecha date, tipo text, cliente_nombre text, servicio_nombre text, comprobante_label text, monto_base numeric, porcentaje numeric, monto_atribuido numeric, saldo_running numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT pr.partner_id INTO v_partner_id
    FROM public.profiles pr
   WHERE pr.id = auth.uid() AND pr.role = 'partner';
  IF v_partner_id IS NULL THEN
    IF NOT private.is_staff() THEN
      RAISE EXCEPTION 'Solo partner o staff' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT
        pa.id AS atribucion_id,
        COALESCE(mc.fecha, m.fecha, c.fecha) AS fecha,
        pa.tipo,
        a.nombre AS cliente_nombre,
        det.detalle AS servicio_nombre,
        CASE WHEN c.id IS NOT NULL
          THEN c.tipo || ' ' ||
               COALESCE(lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'), 's/n')
          ELSE COALESCE(m.descripcion, '—') END AS comprobante_label,
        pa.monto_base::numeric AS monto_base,
        pa.porcentaje::numeric AS porcentaje,
        pa.monto_atribuido::numeric AS monto_atribuido,
        pa.created_at
      FROM public.partner_atribuciones pa
      LEFT JOIN public.movimiento_imputaciones mi ON mi.id = pa.imputacion_id
      LEFT JOIN public.movimientos mc ON mc.id = mi.movimiento_id
      LEFT JOIN public.movimientos m ON m.id = pa.movimiento_id
      LEFT JOIN public.comprobantes c ON c.id = pa.comprobante_id
      LEFT JOIN public.administraciones a ON a.id = COALESCE(c.administracion_id, m.administracion_id)
      -- E-GG-160: antes acá había `LEFT JOIN public.comprobante_items` (tabla
      -- inexistente → 42P01 en runtime) + un join a servicios que multiplicaba
      -- filas por item. Cascada canónica E-GG-159: una fila por atribución.
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
      WHERE pa.partner_id = v_partner_id
        AND (p_desde IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha) >= p_desde)
        AND (p_hasta IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha) <= p_hasta)
    ),
    -- Todas las referencias van CALIFICADAS (b./d./o.): las columnas del
    -- RETURNS TABLE son variables plpgsql y una referencia sin calificar
    -- (p.ej. `atribucion_id` a secas) da 42702 "ambiguous" en runtime —
    -- defecto que el original también tenía y nunca se observó porque la
    -- función jamás llegó a ejecutarse (E-GG-160).
    dedup AS (
      SELECT DISTINCT ON (b.atribucion_id)
        b.atribucion_id, b.fecha, b.tipo, b.cliente_nombre,
        b.servicio_nombre, b.comprobante_label, b.monto_base, b.porcentaje,
        b.monto_atribuido, b.created_at
      FROM base b
      ORDER BY b.atribucion_id, b.servicio_nombre NULLS LAST
    ),
    ordenado AS (
      SELECT d.*,
        SUM(
          CASE WHEN d.tipo = 'ingreso' THEN d.monto_atribuido
               ELSE -d.monto_atribuido END
        ) OVER (ORDER BY d.fecha ASC, d.created_at ASC) AS saldo_running
      FROM dedup d
    )
    SELECT o.atribucion_id, o.fecha, o.tipo, o.cliente_nombre,
           o.servicio_nombre, o.comprobante_label, o.monto_base, o.porcentaje,
           o.monto_atribuido, o.saldo_running
      FROM ordenado o
      ORDER BY o.fecha ASC, o.created_at ASC;
END;
$function$;
