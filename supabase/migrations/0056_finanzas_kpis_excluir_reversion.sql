-- 0056 · E-GG-19 · KPIs del dashboard inflaban con movimientos de reversion.
-- Los contrasientos (origen='reversion') son correcciones, NO ingresos/egresos
-- del mes. Excluirlos del SUM mantiene el saldo_total intacto (que sí los
-- considera porque vienen de cajas_con_saldo).

CREATE OR REPLACE FUNCTION public.fz_dashboard_kpis()
RETURNS TABLE (saldo_total numeric, ingresos_mes numeric, egresos_mes numeric, movs_pendientes integer, cajas_activas integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT SUM(saldo) FROM public.cajas_con_saldo WHERE activo), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado='identificado' AND tipo='ingreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    COALESCE((SELECT SUM(monto) FROM public.movimientos
       WHERE estado='identificado' AND tipo='egreso'
         AND fecha >= date_trunc('month', CURRENT_DATE)
         AND revertido_at IS NULL
         AND origen <> 'reversion'), 0),
    (SELECT COUNT(*)::int FROM public.movimientos WHERE estado='pendiente_id'),
    (SELECT COUNT(*)::int FROM public.cajas WHERE activo)
  WHERE private.is_staff();
$$;
