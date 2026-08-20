-- 0433_reg_email_registro_kpis_rpc.sql
-- REG follow-up (prueba en vivo 2026-08-20): las tarjetas KPI del grid
-- "Correos enviados" disparaban 4 `count=exact` HEAD CONCURRENTES contra
-- `v_email_registro` (total + por estado). Cada count aislado responde bien y
-- rápido (200 · 933), pero 4 en paralelo sobre una vista RLS (UNION + joins) es
-- frágil: bajo un pico de concurrencia devolvían 503 esporádico y las tarjetas
-- quedaban con números erráticos. (Lo que el §6 anotó como "DUDA escala".)
--
-- Fix: UN solo RPC que calcula los 4 contadores en UNA pasada con count()
-- FILTER. SECURITY INVOKER → la RLS de la vista (security_invoker) sigue
-- aplicando con el contexto del que llama (staff ve todo; un administrador,
-- sólo su administración). STABLE. Sin parámetros → no aplica R12
-- (assert_administracion_access es para definers que reciben p_administracion_id;
-- acá la RLS de las tablas base hace el tenancy).

CREATE OR REPLACE FUNCTION public.gerencia_email_registro_kpis()
RETURNS TABLE (total bigint, pendientes bigint, enviados bigint, fallidos bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)                                       AS total,
    count(*) FILTER (WHERE estado = 'pendiente')   AS pendientes,
    count(*) FILTER (WHERE estado = 'enviado')     AS enviados,
    count(*) FILTER (WHERE estado = 'fallido')     AS fallidos
  FROM public.v_email_registro;
$$;

GRANT EXECUTE ON FUNCTION public.gerencia_email_registro_kpis() TO authenticated;

COMMENT ON FUNCTION public.gerencia_email_registro_kpis() IS
  'REG · KPIs del registro de correos en 1 pasada (evita 4 count=exact concurrentes). SECURITY INVOKER: respeta la RLS de v_email_registro.';
