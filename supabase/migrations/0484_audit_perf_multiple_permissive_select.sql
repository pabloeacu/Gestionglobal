-- 0484 · Auditoría 2026-09 · PERFORMANCE (parte 3): consolidar políticas permisivas
-- múltiples DE SÓLO-SELECT donde el merge es provablemente equivalente y NO toca escrituras.
--
-- HALLAZGO (advisor performance, multiple_permissive_policies): tablas con 2+ políticas
-- permisivas para el mismo rol+acción → el planner evalúa todas. Esta mig ataca ÚNICAMENTE
-- los 2 casos "limpios": tablas con DOS políticas permisivas de cmd=SELECT (sin política
-- cmd=ALL de por medio), donde consolidar es un simple `USING (A OR B)`:
--   · comprobantes: comprobantes_select  + comprobantes_partner_select
--   · tramite_eventos: eventos_staff_select + eventos_admin_select
--
-- EL RESTO (≈40 tablas con patrón _staff_all(ALL) + _xxx_select) NO se toca acá: consolidarlas
-- exigiría partir la política ALL en INSERT/UPDATE/DELETE separadas (≈100+ políticas nuevas
-- sobre tablas de dinero/tenancy vivas) para un beneficio ~nulo — porque tras 0482/0483 el
-- `is_staff` de la política ALL es un InitPlan barato y PRIMERO en el OR, así que el SELECT ya
-- corta-circuita óptimo con 2 políticas. Alto churn, cero ganancia → deferido y documentado
-- (DGG-171). Ver también storage 0484-deferido en DGG-170 addendum.
--
-- EQUIVALENCIA (seguro): las políticas PERMISIVAS se combinan con OR por definición de Postgres
-- → una sola política `USING ((A) OR (B))` es idéntica a política(A) + política(B) para TODOS
-- los usuarios (staff, administrador, partner). Sólo cambia el conteo de políticas, no el acceso.
-- Cero riesgo de transcripción: el merge se re-deriva EN LA BD (pg_get_expr de las dos qual
-- vivas) — no se escribe la expresión a mano. Se hace por ALTER (preserva la política que queda:
-- nombre/rol/cmd) + DROP de la redundante. Idempotente (guarda por existencia de la que se
-- pliega). Atómico dentro de la migración → sin ventana de exposición.
--
-- NO toca: políticas de escritura (INSERT/UPDATE/DELETE de comprobantes quedan intactas;
-- tramite_eventos no tiene políticas de escritura — sus writes van por SECURITY DEFINER, R17).
--
-- Verificado: acceso e2e IDÉNTICO antes/después (cliente+gerente, snapshot con rollback) +
-- e2e de partner sintético (rama EXISTS preservada) + §6 adversarial + advisor -2.

DO $$
DECLARE
  spec record;
  keep_qual text;
  fold_qual text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('comprobantes',    'comprobantes_select',  'comprobantes_partner_select'),
      ('tramite_eventos', 'eventos_staff_select', 'eventos_admin_select')
    ) AS t(tbl, keep_pol, fold_pol)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policy
                 WHERE polname = spec.fold_pol
                   AND polrelid = ('public.'||spec.tbl)::regclass)
    THEN
      SELECT pg_get_expr(polqual, polrelid) INTO keep_qual
        FROM pg_policy WHERE polname = spec.keep_pol AND polrelid = ('public.'||spec.tbl)::regclass;
      SELECT pg_get_expr(polqual, polrelid) INTO fold_qual
        FROM pg_policy WHERE polname = spec.fold_pol AND polrelid = ('public.'||spec.tbl)::regclass;

      EXECUTE format('ALTER POLICY %I ON public.%I USING ((%s) OR (%s));',
                     spec.keep_pol, spec.tbl, keep_qual, fold_qual);
      EXECUTE format('DROP POLICY %I ON public.%I;', spec.fold_pol, spec.tbl);
      RAISE NOTICE 'consolidada: % + % -> %', spec.keep_pol, spec.fold_pol, spec.keep_pol;
    END IF;
  END LOOP;
END $$;
