-- 0488 · Auditoría 2026-09 · Deudas menores (barrido): índice R11 faltante + netear crédito en KPI Recupero.
--
-- (1) R11 (regla 11: toda FK necesita su índice). La FK comunicaciones_destinatarios.administracion_id
--     (→ administraciones ON DELETE CASCADE) NO tenía índice de cobertura total: el unique
--     uq_comunicacion_admin la lleva como 2ª columna y idx_comdest_admin_no_visto es PARCIAL
--     (WHERE visto_at IS NULL). Se agrega el índice full. Hoy la tabla tiene 0 filas (sin impacto),
--     pero un ON DELETE CASCADE de una administración haría seq scan sin él. Hallado en la §6 del chunk
--     de índices sin uso (DGG-172).
--
-- (2) SSOT contable (cierre de la deuda menor de DGG-173 Pieza A): el KPI del módulo Recupero mostraba
--     "Deuda vencida" BRUTA (sin netear el crédito del cliente). Pablo pidió netearlo. Se crea
--     public.recupero_kpis() que REUSA public.comprobantes_morosos(NULL) (misma universo exacto que la
--     lista → count idéntico) y netea el crédito disponible por administración (GREATEST(0, bruto-crédito)).
--     Hoy es NO-OP (0 crédito en el sistema → neto == bruto == 2.830.000 / 16); corrige la cifra cuando
--     un moroso tenga saldo a favor. staff-gated (SECURITY DEFINER + is_staff).
--
-- Verificado: índice creado; recupero_kpis == comprobantes_morosos (16 / 2.830.000) hoy; §6.

-- (1) índice R11
CREATE INDEX IF NOT EXISTS idx_comdest_administracion_id
  ON public.comunicaciones_destinatarios (administracion_id);

-- (2) KPI de Recupero neteado (reusa la lista de morosos → consistente por construcción)
CREATE OR REPLACE FUNCTION public.recupero_kpis()
RETURNS TABLE(deuda_vencida numeric, morosos_count int)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH venc AS (
    SELECT m.administracion_id AS aid,
           SUM(m.saldo_pendiente) AS bruto,
           count(*)::int AS n
    FROM public.comprobantes_morosos(NULL) m
    GROUP BY m.administracion_id
  )
  SELECT
    COALESCE(SUM(GREATEST(0, v.bruto - public.administracion_credito_disponible(v.aid))), 0)::numeric,
    COALESCE(SUM(v.n), 0)::int
  FROM venc v;
END; $fn$;

REVOKE ALL ON FUNCTION public.recupero_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recupero_kpis() TO authenticated, service_role;
