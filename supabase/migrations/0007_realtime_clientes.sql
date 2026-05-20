-- ============================================================================
-- 0007_realtime_clientes · activa Supabase Realtime en clientes para que la
-- UI de gerencia refresque KPIs y listas cuando otro usuario crea/edita.
-- Realtime respeta RLS: solo recibe eventos de filas visibles por la policy
-- del rol authenticated del request.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.administraciones;
ALTER PUBLICATION supabase_realtime ADD TABLE public.consorcios;
