-- ============================================================================
-- 0250_rendicion_partner_base_cobrado.sql
-- DGG-86 · La RENDICIÓN del partner pasa a base COBRADO (percibido), alineándola
-- con la sábana (DGG-85). Decisión de Pablo: "todo sobre lo cobrado" + "la
-- rendición debe tener el mismo esquema para ingresos y egresos".
--
-- ANTES (devengado/facturado): el ingreso se atribuía por `c.total` (el total
-- FACTURADO del comprobante) en cuanto se emitía, cobrado o no — una fila por
-- comprobante. El egreso ya era por `m.monto` (lo pagado).
-- AHORA (percibido/cobrado): el ingreso se atribuye por lo efectivamente COBRADO:
-- una fila por CObranza (imputación) del partner cuya FECHA DE COBRO cae en el
-- período; `monto_base = monto_imputado`. El egreso queda igual (ya entra pagado),
-- ⇒ ingresos y egresos con el MISMO criterio (lo que pasó por caja).
--
-- No toca operaciones (comprobantes/movimientos/cobranzas). El histórico NO se
-- recalcula: la RPC sólo CREA rendiciones nuevas; las atribuciones ya existentes
-- quedan intactas (1 ingreso de prueba a la fecha). Aditivo: + columna
-- `imputacion_id` para granularidad/dedup/fecha de cobro.
-- ============================================================================

-- Granularidad cobrado: cada atribución de ingreso referencia su cobranza.
-- SET NULL (no CASCADE): borrar una imputación no debe destruir una línea de una
-- rendición ya cerrada/pagada (registro financiero). El nexo primario sigue
-- siendo comprobante_id (CASCADE), imputacion_id es el secundario (dedup+fecha).
ALTER TABLE public.partner_atribuciones
  ADD COLUMN IF NOT EXISTS imputacion_id uuid
  REFERENCES public.movimiento_imputaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pat_imputacion ON public.partner_atribuciones(imputacion_id);

-- ----------------------------------------------------------------------------
-- partner_crear_rendicion: ingreso = COBRADO. Misma firma (uuid,date,date) ⇒
-- CREATE OR REPLACE no genera overload (R16 OK). Cambia el INSERT ⇒ smoke R18 abajo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(
  p_partner_id uuid,
  p_desde date,
  p_hasta date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rend_id uuid;
  v_convenio record;
  v_ing_brutos numeric(14,2);
  v_ing_atrib numeric(14,2);
  v_cos_brutos numeric(14,2);
  v_cos_atrib numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede crear rendiciones de partner'
      USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo inválido (desde=%, hasta=%)', p_desde, p_hasta
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_convenio
    FROM public.partner_convenios
   WHERE partner_id = p_partner_id
     AND activo
     AND vigencia_desde <= p_hasta
     AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_desde)
   ORDER BY vigencia_desde DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay convenio activo del partner % en el periodo % – %',
      p_partner_id, p_desde, p_hasta USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.partner_rendiciones (
    partner_id, periodo_desde, periodo_hasta, estado, created_by
  )
  VALUES (
    p_partner_id, p_desde, p_hasta, 'borrador', auth.uid()
  )
  RETURNING id INTO v_rend_id;

  -- INGRESOS (COBRADO): una fila por cobranza (imputación) del partner cuya fecha
  -- de COBRO cae en el período. monto_base = lo cobrado en esa operación.
  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT
    p_partner_id, v_convenio.id, v_rend_id,
    mi.comprobante_id, NULL, mi.id,
    'ingreso',
    v_convenio.porc_ingresos,
    mi.monto_imputado,
    ROUND(mi.monto_imputado * v_convenio.porc_ingresos / 100, 2),
    auth.uid()
  FROM public.movimiento_imputaciones mi
  JOIN public.movimientos m ON m.id = mi.movimiento_id
   AND m.tipo = 'ingreso' AND m.estado <> 'anulado'
   AND m.partner_id_atribucion = p_partner_id
  JOIN public.comprobantes c ON c.id = mi.comprobante_id
   AND c.estado <> 'anulado'
  WHERE m.fecha BETWEEN p_desde AND p_hasta
    -- dedup por imputación: no re-atribuir una cobranza ya rendida en otra rendición.
    AND NOT EXISTS (
      SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.imputacion_id = mi.id
         AND pa.rendicion_id <> v_rend_id
    );

  -- COSTOS (sin cambio): egreso por su monto total (ya entra pagado).
  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id, imputacion_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT
    p_partner_id, v_convenio.id, v_rend_id,
    NULL, m.id, NULL,
    'costo',
    v_convenio.porc_costos,
    m.monto,
    ROUND(m.monto * v_convenio.porc_costos / 100, 2),
    auth.uid()
  FROM public.movimientos m
  WHERE m.partner_id_atribucion = p_partner_id
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND m.tipo = 'egreso'
    AND m.estado <> 'anulado'
    AND NOT EXISTS (
      SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.partner_id = p_partner_id
         AND pa.movimiento_id = m.id
         AND pa.rendicion_id <> v_rend_id
    );

  SELECT
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_atribuido END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_atribuido END), 0)
    INTO v_ing_brutos, v_ing_atrib, v_cos_brutos, v_cos_atrib
    FROM public.partner_atribuciones
   WHERE rendicion_id = v_rend_id;

  UPDATE public.partner_rendiciones
     SET total_ingresos_brutos     = v_ing_brutos,
         total_ingresos_atribuidos = v_ing_atrib,
         total_costos_brutos       = v_cos_brutos,
         total_costos_atribuidos   = v_cos_atrib,
         updated_at = now()
   WHERE id = v_rend_id;

  RETURN v_rend_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- partner_rendicion_movimientos: para ingresos cobrado, la FECHA mostrada/filtrada
-- pasa a ser la de la COBRANZA (vía imputacion_id), no la emisión del comprobante.
-- Misma firma y columnas. Costos y filas viejas (imputacion_id NULL) caen al
-- COALESCE → m.fecha / c.fecha como antes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rendicion_movimientos(
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS TABLE(
  atribucion_id     uuid,
  fecha             date,
  tipo              text,
  cliente_nombre    text,
  servicio_nombre   text,
  comprobante_label text,
  monto_base        numeric,
  porcentaje        numeric,
  monto_atribuido   numeric,
  saldo_running     numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
        COALESCE(mc.fecha, m.fecha, c.fecha) AS fecha,   -- cobranza › egreso › emisión
        pa.tipo,
        a.nombre AS cliente_nombre,
        sv.nombre AS servicio_nombre,
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
      LEFT JOIN public.movimientos mc ON mc.id = mi.movimiento_id      -- la cobranza
      LEFT JOIN public.movimientos m ON m.id = pa.movimiento_id        -- el egreso (costo)
      LEFT JOIN public.comprobantes c ON c.id = pa.comprobante_id
      LEFT JOIN public.administraciones a ON a.id = COALESCE(c.administracion_id, m.administracion_id)
      LEFT JOIN public.comprobante_items ci ON ci.comprobante_id = c.id
      LEFT JOIN public.servicios sv ON sv.id = ci.servicio_id
      WHERE pa.partner_id = v_partner_id
        AND (p_desde IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha) >= p_desde)
        AND (p_hasta IS NULL OR COALESCE(mc.fecha, m.fecha, c.fecha) <= p_hasta)
    ),
    dedup AS (
      SELECT DISTINCT ON (atribucion_id)
        atribucion_id, fecha, tipo, cliente_nombre,
        servicio_nombre, comprobante_label, monto_base, porcentaje,
        monto_atribuido, created_at
      FROM base
      ORDER BY atribucion_id, servicio_nombre NULLS LAST
    ),
    ordenado AS (
      SELECT *,
        SUM(
          CASE WHEN tipo = 'ingreso' THEN monto_atribuido
               ELSE -monto_atribuido END
        ) OVER (ORDER BY fecha ASC, created_at ASC) AS saldo_running
      FROM dedup
    )
    SELECT atribucion_id, fecha, tipo, cliente_nombre,
           servicio_nombre, comprobante_label, monto_base, porcentaje,
           monto_atribuido, saldo_running
      FROM ordenado
      ORDER BY fecha ASC, created_at ASC;
END;
$$;
