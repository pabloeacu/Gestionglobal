-- ============================================================================
-- 0005a_view_security_invoker · pasa cajas_con_saldo a SECURITY INVOKER para
-- que las RLS de movimientos/cajas se evalúen con el rol del request.
-- Bajo SECURITY DEFINER (default), la vista bypassaba la RLS — security ERROR.
-- ============================================================================
ALTER VIEW public.cajas_con_saldo SET (security_invoker = true);
