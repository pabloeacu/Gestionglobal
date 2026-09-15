-- 0482 · Auditoría 2026-09 · PERFORMANCE: RLS auth_rls_initplan (41 políticas / 33 tablas).
--
-- HALLAZGO (advisor performance, count=41): las políticas RLS que llaman `auth.uid()`
-- directamente lo RE-EVALÚAN por CADA FILA. Envolviéndolo en `(select auth.uid())` el
-- planner lo evalúa UNA sola vez por consulta (InitPlan) → gran mejora en tablas
-- grandes. Es el fix oficial de Supabase.
--
-- EQUIVALENCIA (por qué es seguro): auth.uid() es constante dentro de una consulta
-- (depende sólo de la sesión, no de la fila). Por lo tanto `(select auth.uid())`
-- evaluado una vez == `auth.uid()` evaluado por fila → MISMO resultado de acceso, sólo
-- cambia cuántas veces se calcula. No se toca NADA más: ni el rol (TO), ni el comando,
-- ni las subconsultas EXISTS correlacionadas, ni is_staff()/current_administracion_id()
-- (quedan igual; su optimización es un chunk aparte), ni las columnas.
--
-- MÉTODO QUIRÚRGICO: transform determinístico re-derivado en la BD (sin transcripción a
-- mano). Sólo toca políticas con `auth.uid()` DESNUDO (excluye las ya envueltas como
-- profiles_*). ALTER POLICY preserva nombre/rol/comando. Idempotente (re-correrlo no
-- reencuentra desnudas) y replay-safe. Genera exactamente 41 ALTER (= count del advisor).
--
-- Verificado: advisor auth_rls_initplan → 0; acceso e2e idéntico antes/después; EXPLAIN
-- muestra el InitPlan. §6 + smoke en el chunk.

DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT format('ALTER POLICY %I ON public.%I%s%s;',
      policyname, tablename,
      CASE WHEN qual IS NOT NULL
        THEN ' USING (' || regexp_replace(qual, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')'
        ELSE '' END,
      CASE WHEN with_check IS NOT NULL
        THEN ' WITH CHECK (' || regexp_replace(with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')'
        ELSE '' END
    ) AS stmt
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ~ 'auth\.uid\(\)' OR with_check ~ 'auth\.uid\(\)')
      AND NOT (COALESCE(qual, '') ~* 'select auth\.uid' OR COALESCE(with_check, '') ~* 'select auth\.uid')
  LOOP
    EXECUTE r.stmt;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'auth_rls_initplan · políticas optimizadas: %', v_count;
END $$;
