-- ============================================================================
-- 0175 · JL-CAJA · Extender fz_listar_cajas_admin para devolver es_default
--
-- La mig 0174 agregó la columna `cajas.es_default` pero el RPC que el
-- frontend usa para listar (`fz_listar_cajas_admin`) tenía un `RETURNS
-- TABLE(...)` cerrado, así que el campo no llegaba al frontend.
--
-- R16: cambiar el shape de retorno requiere DROP + CREATE explícito (no
-- `CREATE OR REPLACE` solo, porque al cambiar la lista de columnas
-- retornadas Postgres rechaza el REPLACE).
-- ============================================================================

DROP FUNCTION IF EXISTS public.fz_listar_cajas_admin(boolean);

CREATE OR REPLACE FUNCTION public.fz_listar_cajas_admin(
  p_incluir_archivadas boolean DEFAULT true
) RETURNS TABLE(
  caja_id uuid,
  nombre text,
  tipo text,
  moneda text,
  color text,
  icono text,
  orden integer,
  activo boolean,
  cbu text,
  alias text,
  numero_cuenta text,
  banco_entidad text,
  saldo numeric,
  cantidad_movimientos bigint,
  created_at timestamp with time zone,
  es_default boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede listar cajas';
  END IF;
  RETURN QUERY
  SELECT c.id AS caja_id, c.nombre, c.tipo, c.moneda, c.color, c.icono, c.orden, c.activo,
    c.cbu, c.alias, c.numero_cuenta, c.banco_entidad,
    COALESCE(saldo_calc.saldo, 0)::numeric AS saldo,
    COALESCE(saldo_calc.cantidad_movimientos, 0)::bigint AS cantidad_movimientos,
    c.created_at,
    c.es_default
  FROM public.cajas c
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto
               WHEN m.tipo IN ('egreso','transferencia_out') THEN -m.monto
               ELSE 0 END) AS saldo,
      COUNT(*) AS cantidad_movimientos
    FROM public.movimientos m
    WHERE m.caja_id = c.id AND m.estado <> 'anulado'
  ) saldo_calc ON true
  WHERE p_incluir_archivadas OR c.activo
  ORDER BY c.activo DESC, c.orden, c.nombre;
END $function$;

REVOKE EXECUTE ON FUNCTION public.fz_listar_cajas_admin(boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fz_listar_cajas_admin(boolean) TO authenticated;
