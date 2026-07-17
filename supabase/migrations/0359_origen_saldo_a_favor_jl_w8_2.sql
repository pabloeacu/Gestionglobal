-- 0359 · JL-W8-2 · Etiqueta de ORIGEN en el saldo a favor (sólo informativo).
-- JL: "A simple vista no sabemos si el Saldo a Favor es de un Servicio o de un
-- Curso… tan solo una etiqueta que nos permita identificar de dónde salió. No
-- cambiar la operatoria de aplicación." → cero cambios en imputar_credito_a_
-- comprobante / registrar_cobranza / triggers de saldo. Este archivo es 100%
-- capa de LECTURA.
--
-- Derivación del origen (lección E-GG-77): SIEMPRE desde movimientos.
-- comprobante_id (el comprobante de la cobranza ORIGINAL), jamás desde
-- movimiento_imputaciones (eso es el DESTINO de la aplicación). Las FKs de
-- servicio están vacías en prod (comprobantes.servicio_id 0/9, items 0/9,
-- tramites.comprobante_id 0) → cadena de fallback obligatoria terminando en
-- items_comprobantes.descripcion (la única fuente poblada, ej. "Curso de
-- Formación RPAC") y c.concepto.

-- ── 1 · listar_creditos_administracion + 4 columnas de origen ────────────────
-- Extender el RETURNS TABLE exige DROP+CREATE (42P13: cannot change return
-- type). La firma de ENTRADA (uuid) no cambia → no nace overload (R16), pero
-- el DROP pierde los GRANTs → re-emitirlos acá mismo.
DROP FUNCTION IF EXISTS public.listar_creditos_administracion(uuid);

CREATE FUNCTION public.listar_creditos_administracion(p_administracion_id uuid)
RETURNS TABLE(
  movimiento_id uuid,
  fecha date,
  monto numeric,
  saldo_disponible numeric,
  descripcion text,
  comprobante_origen text,
  -- JL-W8-2 · columnas nuevas AL FINAL (los mappers existentes leen por nombre)
  comprobante_origen_id uuid,
  comprobante_origen_estado text,
  origen_tipo text,      -- 'comprobante' | 'comprobante_anulado' | 'pago_a_cuenta'
  origen_detalle text    -- servicio/curso/trámite/concepto del comprobante origen
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.fecha, m.monto,
         m.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                              WHERE mi.movimiento_id = m.id), 0) AS saldo_disponible,
         m.descripcion,
         (SELECT c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0') || '-' || lpad(c.numero::text, 8, '0')
            FROM public.comprobantes c WHERE c.id = m.comprobante_id) AS comprobante_origen,
         m.comprobante_id AS comprobante_origen_id,
         ori.estado AS comprobante_origen_estado,
         CASE
           WHEN m.comprobante_id IS NULL THEN 'pago_a_cuenta'
           WHEN ori.estado = 'anulado' THEN 'comprobante_anulado'
           ELSE 'comprobante'
         END AS origen_tipo,
         ori.detalle AS origen_detalle
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT c.estado,
             left(COALESCE(
               (SELECT s.nombre FROM public.servicios s WHERE s.id = c.servicio_id),
               (SELECT string_agg(ic.descripcion, ' + ' ORDER BY ic.orden)
                  FROM public.items_comprobantes ic WHERE ic.comprobante_id = c.id),
               (SELECT t.titulo FROM public.tramites t
                 WHERE t.comprobante_id = c.id LIMIT 1),
               NULLIF(c.concepto, '')
             ), 160) AS detalle
        FROM public.comprobantes c
       WHERE c.id = m.comprobante_id
    ) ori ON true
   WHERE m.administracion_id = p_administracion_id
     AND m.tipo = 'ingreso'
     AND m.estado = 'identificado'
     AND m.revertido_at IS NULL
     AND m.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                              WHERE mi.movimiento_id = m.id), 0) > 0
   ORDER BY m.fecha DESC, m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_creditos_administracion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_creditos_administracion(uuid) TO authenticated, service_role;

-- ── 2 · cuenta_corriente_extracto · rama saldo_favor con origen ──────────────
-- Misma firma de entrada Y de retorno → CREATE OR REPLACE seguro (R16). El único
-- cambio es la DESCRIPCION de la rama 3 ('saldo_favor'): se le appendea
-- " · origen: <detalle>" derivado del comprobante de la cobranza original.
-- OJO: cliente_ctacte_extracto (portal) delega acá → el texto llega también al
-- cliente; copy neutro apto para esa audiencia.
CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(p_administracion_id uuid, p_desde date, p_hasta date)
RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric, saldo numeric, comprobante_id uuid, movimiento_id uuid, imputacion_id uuid, consorcio_nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
        -- JL-W8-2 · origen del crédito (comprobante de la cobranza original)
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
      SELECT left(COALESCE(
               (SELECT s.nombre FROM public.servicios s WHERE s.id = c.servicio_id),
               (SELECT string_agg(ic.descripcion, ' + ' ORDER BY ic.orden)
                  FROM public.items_comprobantes ic WHERE ic.comprobante_id = c.id),
               (SELECT t.titulo FROM public.tramites t
                 WHERE t.comprobante_id = c.id LIMIT 1),
               NULLIF(c.concepto, '')
             ), 160) AS detalle
        FROM public.comprobantes c
       WHERE c.id = m.comprobante_id
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
$$;
