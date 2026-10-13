-- 0561_hardening_search_path.sql
-- =============================================================================
-- Hardening de seguridad (advisor Supabase 2026-10-13).
-- El advisor `function_search_path_mutable` flagea `public.prospecto_segmento`
-- (función pura de fechas, LANGUAGE sql IMMUTABLE) por tener search_path mutable.
-- Fix: fijar `SET search_path = ''` (la función no referencia ningún objeto de
-- esquema — sólo operadores de pg_catalog —, así que el search_path vacío es
-- seguro y limpia el warning). Misma firma → sin overloads (R16).
--
-- Contexto: el aviso por mail de Supabase del 11-Oct ("rls_disabled_in_public /
-- tabla públicamente accesible") ya estaba RESUELTO al 13-Oct — verificado que
-- hay 0 tablas del esquema public con RLS desactivada. Las 5 tablas tramix_*
-- (rls_enabled_no_policy, INFO) están cerradas a propósito (sólo service_role vía
-- edge functions; anon/authenticated sin SELECT). Los warnings SECDEF
-- (anon/authenticated executable) son la arquitectura por diseño (R5/R12).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prospecto_segmento(p_venc date, p_hoy date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_venc IS NULL THEN 'sin_dato'
    WHEN p_venc < p_hoy THEN 'vencida'
    WHEN p_venc <= p_hoy + 30 THEN 'curso_reno_30'
    WHEN p_venc <= p_hoy + 90 THEN 'curso_31_90'
    ELSE 'vigente_lejos'
  END;
$function$;
