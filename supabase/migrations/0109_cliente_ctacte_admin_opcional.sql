-- ============================================================================
-- Migration: 0109_cliente_ctacte_admin_opcional
-- Fecha: 2026-05-28
-- DGG-XX · cliente_ctacte_extracto ahora acepta p_admin_id opcional. Cuando
-- el caller es staff, le permitimos consultar la CC de cualquier admin
-- (gerencia > Clientes > Cta. corriente). Cuando el caller es el cliente,
-- ignora ese param y usa current_administracion_id() como antes.
-- ============================================================================

DROP FUNCTION IF EXISTS public.cliente_ctacte_extracto(date, date);

CREATE FUNCTION public.cliente_ctacte_extracto(
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL
)
RETURNS TABLE(
  fecha date, tipo text, descripcion text,
  debe numeric, haber numeric, saldo numeric,
  comprobante_id uuid, movimiento_id uuid, imputacion_id uuid,
  consorcio_nombre text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_admin_id uuid;
  v_desde    date;
  v_hasta    date;
BEGIN
  IF p_admin_id IS NOT NULL THEN
    IF NOT private.is_staff() THEN
      RAISE EXCEPTION 'Solo staff puede consultar CC de otra administración'
        USING ERRCODE = '42501';
    END IF;
    v_admin_id := p_admin_id;
  ELSE
    v_admin_id := private.current_administracion_id();
  END IF;
  IF v_admin_id IS NULL THEN
    RETURN;
  END IF;
  v_desde := COALESCE(p_desde, (CURRENT_DATE - INTERVAL '1 year')::date);
  v_hasta := COALESCE(p_hasta, CURRENT_DATE);
  RETURN QUERY
  SELECT * FROM public.cuenta_corriente_extracto(v_admin_id, v_desde, v_hasta);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_ctacte_extracto(date, date, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cliente_ctacte_extracto(date, date, uuid) TO authenticated;
