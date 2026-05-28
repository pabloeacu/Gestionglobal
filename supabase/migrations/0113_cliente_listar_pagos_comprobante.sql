-- ============================================================================
-- Migration: 0113_cliente_listar_pagos_comprobante
-- Fecha: 2026-05-28
-- DGG-XX · Bug walkthrough: en el detalle de comprobante del portal cliente,
-- "Pagos registrados" mostraba "Sin pagos" aunque la cobranza existiera y
-- estuviera reflejada en saldo_pendiente / estado_cobranza.
--
-- Root cause:
--   * PortalComprobanteDetailPage llama .from('movimiento_imputaciones')
--     con movimientos!inner.
--   * RLS movimientos_select_staff exige private.is_staff() — el rol
--     'administrador' (cliente) queda bloqueado en el inner join.
--
-- Fix: RPC SECURITY DEFINER que valida pertenencia del comprobante a la
-- administración del usuario (o staff bypass) y devuelve los pagos con la
-- info necesaria de la caja.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_listar_pagos_comprobante(
  p_comprobante_id uuid
) RETURNS TABLE(
  imputacion_id uuid,
  movimiento_id uuid,
  fecha date,
  caja_nombre text,
  referencia text,
  monto_imputado numeric,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_actual uuid;
  v_admin_comp   uuid;
BEGIN
  SELECT c.administracion_id INTO v_admin_comp
    FROM public.comprobantes c WHERE c.id = p_comprobante_id;
  IF v_admin_comp IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF private.is_staff() THEN
    -- staff bypass
  ELSE
    v_admin_actual := private.current_administracion_id();
    IF v_admin_actual IS NULL OR v_admin_actual <> v_admin_comp THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY
    SELECT
      mi.id, m.id, m.fecha,
      ca.nombre, m.referencia,
      mi.monto_imputado::numeric, mi.created_at
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    LEFT JOIN public.cajas ca ON ca.id = m.caja_id
    WHERE mi.comprobante_id = p_comprobante_id
      AND m.estado = 'identificado'
    ORDER BY m.fecha DESC, mi.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_listar_pagos_comprobante(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cliente_listar_pagos_comprobante(uuid) TO authenticated;
