-- ============================================================================
-- Mig 0630 · DGG-237 · Advisor ERROR: v_matriculas era SECURITY DEFINER.
--
-- La vista `public.v_matriculas` (creada en 0605, dgg234 multijurisdicción)
-- resume matrícula PBA (administraciones) + jurisdicciones extra (matricula_extra).
-- Se creó SIN `security_invoker`, por lo que corría con privilegios del owner
-- (postgres) y BYPASSEABA la RLS de las dos tablas base. Combinado con el SELECT
-- por defecto a `anon`/`authenticated`, el endpoint REST /rest/v1/v_matriculas
-- exponía matrícula_nro, legajo y vencimiento de TODAS las administraciones a
-- cualquier portador de la anon key → fuga de tenancy (regla 12 / R12).
--
-- La vista hoy NO tiene consumidores en la app (sólo figura en los types
-- generados), así que el fix es puramente defensivo y sin riesgo funcional:
--   1. security_invoker=true → la RLS del invocador aplica sobre las tablas base
--      (gerente=staff ve todo; cliente ve sólo su administración; anon no ve nada).
--   2. Sacar el SELECT (y los write-grants espurios) de `anon`.
--   3. Dejar a `authenticated` sólo SELECT (ya acotado por RLS vía invoker).
-- ============================================================================

ALTER VIEW public.v_matriculas SET (security_invoker = true);

REVOKE ALL ON public.v_matriculas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_matriculas FROM authenticated;
