-- 0344 · DGG-108 / E-GG-120: unificación canónica del saldo.
--
-- El barrido de consistencia (wave 6) encontró que las 4 superficies de saldo
-- podían divergir. La ÚNICA desalineada de neteo es el Portal Inicio, que usa
-- `cliente_deuda_neta` devolviendo DEUDA BRUTA (no resta el crédito/saldo a favor)
-- → el mismo cliente mostraba "$410.000 a regularizar" en el Inicio y "$205.000"
-- en la Cta.Cte. (caso que JL marcó). Las otras 3 superficies ya netean.
--
-- CANON: saldo neto = Σ comprobantes.saldo_pendiente (vivos) − Σ créditos residuales
-- de ingresos no imputados. En el caso NORMAL (toda cobranza imputada completa) el
-- crédito es 0 → neto == bruto → NINGÚN número cambia. Sólo se corrige el
-- sobre-reporte cuando existe un saldo a favor real.
--
-- Cambios (todos CREATE OR REPLACE, misma firma → sin overloads, R16 ok; los grants
-- previos se preservan porque CREATE OR REPLACE no dropea la función):
--   1. NUEVO helper canónico `administracion_credito_disponible` (única definición
--      del crédito; hoy duplicada inline en 3 funciones).
--   2. `cliente_deuda_neta` → total NETO (resta el helper, floor 0) + excluye borrador.
--   3. `administraciones_con_deuda` y `cuenta_corriente_morosos` → usan el helper
--      (refactor idempotente: MISMOS números, una sola fuente de verdad).

-- ── 1) Helper canónico del crédito disponible ────────────────────────────────
-- Devuelve Σ residual (monto − Σ imputado) de los ingresos identificados no
-- revertidos de la administración. Guard de tenancy: staff O dueño → valor real;
-- cualquier otro → 0 (no RAISE, para poder usarse dentro de queries agregadas sin
-- romperlas, y sin filtrar el crédito a terceros).
CREATE OR REPLACE FUNCTION public.administracion_credito_disponible(p_admin_id uuid)
 RETURNS numeric
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN (SELECT private.is_staff())
      OR EXISTS (SELECT 1 FROM public.administraciones a WHERE a.id = p_admin_id AND a.user_id = auth.uid())
    THEN COALESCE((
      SELECT SUM(m.monto - COALESCE(imp.aplicado, 0))
      FROM public.movimientos m
      LEFT JOIN LATERAL (
        SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
         WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
      ) imp ON true
      WHERE m.administracion_id = p_admin_id
        AND m.tipo = 'ingreso' AND m.estado = 'identificado' AND m.revertido_at IS NULL
        AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    ), 0)
    ELSE 0
  END;
$function$;

REVOKE ALL ON FUNCTION public.administracion_credito_disponible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.administracion_credito_disponible(uuid) TO authenticated, service_role;

-- ── 2) cliente_deuda_neta → NETO real (Portal Inicio) ────────────────────────
-- total = GREATEST(0, deuda_bruta − crédito). Los counts siguen a nivel comprobante.
CREATE OR REPLACE FUNCTION public.cliente_deuda_neta(p_administracion_id uuid)
 RETURNS TABLE(total numeric, pendientes_count integer, vencidos_count integer, proximo_vencimiento date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    GREATEST(0, COALESCE(SUM(saldo_pendiente), 0)
                - public.administracion_credito_disponible(p_administracion_id))::numeric AS total,
    COUNT(*)::int AS pendientes_count,
    COUNT(*) FILTER (WHERE vencimiento < CURRENT_DATE)::int AS vencidos_count,
    MIN(vencimiento) FILTER (WHERE vencimiento >= CURRENT_DATE) AS proximo_vencimiento
  FROM public.comprobantes
  WHERE administracion_id = p_administracion_id
    AND saldo_pendiente > 0
    AND estado_cobranza NOT IN ('cancelado','anulado')
    AND estado NOT IN ('anulado','borrador')  -- DGG-108: excluir borrador (canon)
    -- AUDIT-008: tenancy guard inline (sin assert para mantener SQL function STABLE).
    AND (
      (SELECT private.is_staff())
      OR EXISTS (
        SELECT 1 FROM public.administraciones a
        WHERE a.id = p_administracion_id AND a.user_id = auth.uid()
      )
    );
$function$;

-- ── 3) administraciones_con_deuda → usa el helper (idempotente) ──────────────
-- Preserva el guard hardened `IS NOT TRUE` (E-GG-119) y el REVOKE anon (0343).
CREATE OR REPLACE FUNCTION public.administraciones_con_deuda()
 RETURNS SETOF uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT c.administracion_id AS id, COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta
    FROM public.comprobantes c
    WHERE c.administracion_id IS NOT NULL
      AND c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente > 0
    GROUP BY c.administracion_id
  )
  SELECT d.id
  FROM deudas d
  WHERE (d.deuda_bruta - public.administracion_credito_disponible(d.id)) > 0;
END;
$function$;

-- ── 4) cuenta_corriente_morosos → usa el helper (idempotente) ────────────────
CREATE OR REPLACE FUNCTION public.cuenta_corriente_morosos(p_limit integer DEFAULT 10)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, deuda_total numeric, comprobantes_vencidos integer, comprobantes_pendientes integer, mayor_dias_vencido integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff puede consultar morosos'; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT a.id, a.nombre,
      COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta,
      COUNT(*) FILTER (WHERE c.estado_cobranza='vencido')::int AS venc,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pend,
      COALESCE(MAX(CASE WHEN c.estado_cobranza='vencido' AND c.vencimiento IS NOT NULL
                        THEN (current_date - c.vencimiento)::int ELSE 0 END),0)::int AS maxdias
    FROM public.administraciones a
    JOIN public.comprobantes c ON c.administracion_id=a.id
    WHERE c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente>0
    GROUP BY a.id, a.nombre
  ),
  neto AS (
    SELECT d.*, (d.deuda_bruta - public.administracion_credito_disponible(d.id)) AS deuda_neta
    FROM deudas d
  )
  SELECT n.id, n.nombre, n.deuda_neta::numeric, n.venc, n.pend, n.maxdias
  FROM neto n
  WHERE n.deuda_neta > 0
  ORDER BY n.deuda_neta DESC
  LIMIT GREATEST(p_limit,1);
END;
$function$;
