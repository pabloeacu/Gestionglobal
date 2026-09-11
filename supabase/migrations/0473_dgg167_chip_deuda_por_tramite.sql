-- DGG-167 · El chip "Con Deuda" de la lista de trámites debe ser POR TRÁMITE, no
-- por cliente (pedido JL, decisión de Pablo).
--
-- Bug (reporte JL): SANCLAUDIO mostraba "Con Deuda" en sus DOS trámites de curso,
-- pero la única que adeuda es Formación; la de CABA ya está paga. Causa: el chip
-- usaba `administraciones_con_deuda` (deuda NETA del cliente en cta.cte — E-GG-116),
-- así que TODOS los trámites de un cliente con deuda neta mostraban el chip. Un badge
-- sobre la fila del trámite se lee como "este trámite", pero la lógica era "este
-- cliente". Pablo eligió pasar el chip a POR TRÁMITE (los avisos/gates de cierre por
-- deuda —trigger tramite_cerrar_exige_cobrado, per-trámite— NO se tocan y persisten).
--
-- Señal per-trámite = `cobro_pendiente(t)` (comprobante con saldo, mismo metric que el
-- gate de cierre) OR una matrícula de curso vinculada adeudada/parcial (4 cursos vivos
-- tienen deuda de matrícula SIN comprobante pendiente → si sólo miráramos
-- cobro_pendiente los perderíamos; Pablo: "no perder de vista si hay algo pendiente de
-- cobrar"). Se expone como columna computada (patrón de cobro_pendiente) para que la
-- lista la traiga por fila sin llamada batched extra.

CREATE OR REPLACE FUNCTION public.tramite_tiene_deuda(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.cobro_pendiente(t)
      OR EXISTS (
           SELECT 1 FROM public.curso_matriculas cm
            WHERE cm.tramite_id = t.id
              AND cm.estado_pago IN ('adeudado', 'pago_parcial')
         );
$function$;

REVOKE EXECUTE ON FUNCTION public.tramite_tiene_deuda(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_tiene_deuda(public.tramites) TO authenticated, service_role;
