-- ============================================================================
-- Migration: 0102_fix_partner_crear_rendicion_null_cast
-- Fecha: 2026-05-28
-- DGG-XX · Fix #145 sub-bug: partner_crear_rendicion (mig 0028) hacía
--   ... c.id, NULL, 'ingreso', ...
-- en un SELECT DISTINCT y Postgres inferia NULL como TEXT, que rompía el
-- INSERT en partner_atribuciones.movimiento_id (tipo uuid). Misma situación
-- en el segundo INSERT con comprobante_id. Cast explícito a NULL::uuid.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(
  p_partner_id uuid,
  p_desde date,
  p_hasta date
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
    RAISE EXCEPTION 'Solo staff puede crear rendiciones de partner' USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo inválido (desde=%, hasta=%)', p_desde, p_hasta USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_convenio
    FROM public.partner_convenios
   WHERE partner_id = p_partner_id AND activo
     AND vigencia_desde <= p_hasta
     AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_desde)
   ORDER BY vigencia_desde DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay convenio activo del partner % en el periodo % – %',
      p_partner_id, p_desde, p_hasta USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.partner_rendiciones (
    partner_id, periodo_desde, periodo_hasta, estado, created_by
  ) VALUES (
    p_partner_id, p_desde, p_hasta, 'borrador', auth.uid()
  ) RETURNING id INTO v_rend_id;

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT DISTINCT
    p_partner_id, v_convenio.id, v_rend_id,
    c.id, NULL::uuid,
    'ingreso',
    v_convenio.porc_ingresos,
    c.total,
    ROUND(c.total * v_convenio.porc_ingresos / 100, 2),
    auth.uid()
  FROM public.comprobantes c
  WHERE c.estado = 'autorizado'
    AND c.fecha BETWEEN p_desde AND p_hasta
    AND c.tipo IN ('A','B','C','X')
    AND EXISTS (
      SELECT 1 FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
       WHERE mi.comprobante_id = c.id
         AND m.partner_id_atribucion = p_partner_id
    );

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT
    p_partner_id, v_convenio.id, v_rend_id,
    NULL::uuid, m.id,
    'costo',
    v_convenio.porc_costos,
    m.monto,
    ROUND(m.monto * v_convenio.porc_costos / 100, 2),
    auth.uid()
  FROM public.movimientos m
  WHERE m.partner_id_atribucion = p_partner_id
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND m.tipo = 'egreso'
    AND m.estado <> 'anulado';

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
