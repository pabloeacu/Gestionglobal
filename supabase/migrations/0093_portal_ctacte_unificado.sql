-- ============================================================================
-- Migration: 0093_portal_ctacte_unificado
-- Fecha: 2026-05-27
-- DGG-XX · Fix #144: Sincronización CC gerencia ↔ portal cliente
--
-- BUG REPORTADO: el usuario hizo cobranza desde gerencia y NO se reflejaba en
-- la CC del portal cliente. Causa raíz: el portal usaba 2 queries TypeScript
-- separados (comprobantes + imputaciones) en lugar de la RPC SQL atómica
-- `cuenta_corriente_extracto` que usa gerencia → orígenes divergentes y sin
-- atomicidad → race conditions visibles al usuario.
--
-- Fix: nueva RPC `cliente_ctacte_extracto()` que envuelve la lógica de
-- `cuenta_corriente_extracto` pero usando el contexto de la administración
-- del cliente logueado (no parámetro). Single query SQL = misma fuente que
-- gerencia. El realtime refresh sigue funcionando porque suscribe a las
-- mismas tablas (comprobantes + movimiento_imputaciones).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_ctacte_extracto(
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
)
RETURNS TABLE (
  fecha            date,
  tipo             text,
  descripcion      text,
  debe             numeric,
  haber            numeric,
  saldo            numeric,
  comprobante_id   uuid,
  movimiento_id    uuid,
  imputacion_id    uuid,
  consorcio_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_admin_id uuid;
  v_desde    date;
  v_hasta    date;
BEGIN
  -- 1) Resolver administracion del usuario logueado (via profiles)
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    -- Usuario no vinculado a administración → tabla vacía (no falla)
    RETURN;
  END IF;

  -- 2) Defaults: últimos 12 meses si no se especifica rango
  v_desde := COALESCE(p_desde, (CURRENT_DATE - INTERVAL '1 year')::date);
  v_hasta := COALESCE(p_hasta, CURRENT_DATE);

  -- 3) Delegar a la RPC de gerencia (misma lógica = misma fuente de datos).
  --    El SECURITY DEFINER de cuenta_corriente_extracto valida acceso via
  --    private.assert_administracion_access(v_admin_id) — para un cliente
  --    autenticado consultando SU propia admin pasa OK.
  RETURN QUERY
  SELECT * FROM public.cuenta_corriente_extracto(v_admin_id, v_desde, v_hasta);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_ctacte_extracto(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_ctacte_extracto(date, date) TO authenticated;

COMMENT ON FUNCTION public.cliente_ctacte_extracto IS
  'Extracto de cuenta corriente para el cliente logueado. Reusa cuenta_corriente_extracto de gerencia para garantizar consistencia entre gerencia y portal (fix #144). Sin parámetros usa últimos 12 meses; admin_id implícito desde profiles.';
