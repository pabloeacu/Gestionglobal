-- ============================================================================
-- 0194 · DGG-44 hardening · cobro_pendiente → SECURITY INVOKER
--
-- El advisor 0029 (authenticated_security_definer_function_executable) marcó
-- que `cobro_pendiente` era SECURITY DEFINER y por ende un usuario autenticado
-- podía invocarla vía /rest/v1/rpc/cobro_pendiente salteando RLS de
-- comprobantes/solicitudes (fuga del booleano "impago" de cualquier
-- comprobante, aunque los UUID son no-adivinables).
--
-- No hacía falta DEFINER: el ÚNICO consumidor es el kanban (staff), y staff
-- ya lee TODOS los comprobantes (policy comprobantes_select) y solicitudes
-- (policy sol_staff_all) por RLS. Con INVOKER el resultado para staff es
-- idéntico, y un cliente que invocara la RPC sólo vería sus propias filas
-- (sin fuga). is_staff() = rol IN ('gerente','operador').
--
-- Verificado e2e bajo RLS real de gerente (SET ROLE authenticated + JWT del
-- gerente): impago→true, sin_comprobante→false. Idéntico a DEFINER.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cobro_pendiente(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comprobantes c
    WHERE c.estado <> 'anulado'
      AND COALESCE(c.total, 0) > 0
      AND COALESCE(c.saldo_pendiente, 0) > 0
      AND (
        c.id = t.comprobante_id
        OR c.id IN (
          SELECT s.comprobante_id
          FROM public.solicitudes s
          WHERE s.tramite_id = t.id
            AND s.comprobante_id IS NOT NULL
        )
      )
  );
$$;

COMMENT ON FUNCTION public.cobro_pendiente(public.tramites) IS
  'DGG-44 · Computed column (Postgrest), SECURITY INVOKER. TRUE si el trámite tiene un comprobante con costo (total>0) e impago (saldo_pendiente>0), no anulado, por cualquiera de los dos caminos (tramites.comprobante_id o solicitudes.tramite_id→comprobante_id). Bajo INVOKER respeta RLS del invocador: staff ve todo; un cliente sólo sus filas.';

REVOKE EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) TO authenticated;
