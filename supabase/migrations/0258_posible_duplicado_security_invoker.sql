-- ============================================================================
-- 0258_posible_duplicado_security_invoker.sql
-- DGG-89 §6 · Consistencia con la lección E-GG-73: las funciones-columna hermanas
-- (cobro_pendiente 0194, comprobante_pendiente 0207, cobro_estado 0256) declaran
-- SECURITY INVOKER explícito tras el advisor 0029. La 0257 lo omitía (caía en el
-- default = INVOKER, funcionalmente idéntico). Lo explicitamos para que el grep de
-- auditoría sea uniforme. Cuerpo idéntico a 0257.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.posible_duplicado(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT t.estado <> 'cancelado'
     AND t.solicitante_email IS NOT NULL
     AND t.servicio_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.tramites o
        WHERE o.id <> t.id
          AND o.estado <> 'cancelado'
          AND o.servicio_id = t.servicio_id
          AND lower(o.solicitante_email) = lower(t.solicitante_email)
          AND o.periodo IS NOT DISTINCT FROM t.periodo
     );
$function$;
