-- 0483 · Auditoría 2026-09 · PERFORMANCE (parte 2): envolver los helpers de sesión de
-- RLS en (select ...) para llevarlos a InitPlan (evaluar 1 vez por consulta, no por fila).
--
-- Continúa 0482 (que envolvió auth.uid()). Acá van private.is_staff() (163 políticas),
-- private.current_administracion_id() (21) y private.is_administrador() (12) — 176
-- políticas distintas. Estos helpers LEEN la tabla profiles por fila, así que el ahorro
-- es MAYOR que el de auth.uid().
--
-- EQUIVALENCIA (seguro): los 3 son 0-args + STABLE + SECURITY DEFINER, y dependen sólo
-- de la sesión (auth.uid()), no de la fila → constantes dentro de una consulta. Por eso
-- (select fn()) evaluado una vez == fn() por fila → MISMO acceso, sólo cambia la
-- frecuencia de evaluación. NO son correlacionados (no toman argumentos de la fila).
-- No se toca ninguna función que reciba argumentos (p.ej. assert_administracion_access(id)
-- SÍ es correlacionada → jamás se envuelve).
--
-- MÉTODO: transform determinístico re-derivado en la BD (ALTER POLICY, preserva
-- rol/comando/permissive). Sólo políticas con el helper DESNUDO (excluye ya-envueltas).
-- Idempotente + replay-safe. Compone con el wrap de auth.uid() de 0482 (no lo pisa).
--
-- Verificado: 176 políticas; 0 helper desnudo restante; acceso e2e IDÉNTICO antes/después
-- (cliente + gerente); §6 adversarial + smoke.

DO $$
DECLARE
  r record;
  v_count int := 0;
  fn_wrap text;
BEGIN
  FOR r IN
    SELECT policyname, tablename,
      CASE WHEN qual IS NOT NULL THEN
        regexp_replace(regexp_replace(regexp_replace(qual,
          'private\.is_staff\(\)', '(select private.is_staff())', 'g'),
          'private\.current_administracion_id\(\)', '(select private.current_administracion_id())', 'g'),
          'private\.is_administrador\(\)', '(select private.is_administrador())', 'g')
      END AS new_qual,
      CASE WHEN with_check IS NOT NULL THEN
        regexp_replace(regexp_replace(regexp_replace(with_check,
          'private\.is_staff\(\)', '(select private.is_staff())', 'g'),
          'private\.current_administracion_id\(\)', '(select private.current_administracion_id())', 'g'),
          'private\.is_administrador\(\)', '(select private.is_administrador())', 'g')
      END AS new_check,
      qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (COALESCE(qual,'')||COALESCE(with_check,'')) ~ 'private\.(is_staff|current_administracion_id|is_administrador)\(\)'
      AND NOT (COALESCE(qual,'')||COALESCE(with_check,'')) ~* 'select private\.(is_staff|current_administracion_id|is_administrador)'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I%s%s;',
      r.policyname, r.tablename,
      CASE WHEN r.qual IS NOT NULL THEN ' USING (' || r.new_qual || ')' ELSE '' END,
      CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.new_check || ')' ELSE '' END
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'helpers RLS envueltos en (select): % politicas', v_count;
END $$;
