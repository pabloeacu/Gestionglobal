-- ============================================================================
-- 0257_tramite_posible_duplicado.sql
-- DGG-89 · Un solicitante impaciente reenvía el formulario → 2 submissions → 2
-- solicitudes → gerencia activa ambas → 2 trámites (el campus deduplica por la
-- matrícula única, gerencia no). Campo calculado para SEÑALAR en la lista de
-- gerencia los trámites que tienen otro hermano no-cancelado del mismo
-- servicio + período + solicitante (email, case-insensitive) = probable reenvío.
-- Sólo señaliza (no bloquea, no borra). Identidad alineada con
-- buscarTramiteDuplicado() del wizard de activación (que AVISA antes de abrir el 2º).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.posible_duplicado(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
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

REVOKE EXECUTE ON FUNCTION public.posible_duplicado(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posible_duplicado(public.tramites) TO authenticated;
COMMENT ON FUNCTION public.posible_duplicado(public.tramites) IS
  'DGG-89 · TRUE si el trámite tiene otro hermano no-cancelado del mismo servicio_id + período + solicitante_email (case-insensitive) = probable reenvío del formulario. Sólo para el badge de la lista de gerencia.';
