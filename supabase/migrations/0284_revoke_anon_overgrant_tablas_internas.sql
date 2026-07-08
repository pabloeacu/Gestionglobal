-- 0284 · Blindaje sistémico (línea E-GG-88 / continuación de 0279 y 0283):
-- quitarle a `anon` el over-grant de privilegios DIRECTOS heredado del default
-- PUBLIC → anon de Postgres pre-0130.
--
-- Contexto (§6 de E-GG-91 pieza 2): TODAS las tablas de `public` tenían los 7
-- privilegios (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)
-- concedidos directamente a `anon`. En las tablas internas eso HOY no filtra
-- nada porque la RLS está activa y no tienen policy que le aplique a anon
-- (sin policy → PostgREST le niega las filas), pero es exactamente el patrón
-- "grant a quien nunca debe llamar" que 0279 limpió en funciones. Defensa en
-- profundidad: si mañana alguien agrega por error una policy permisiva o
-- desactiva RLS en una de estas tablas, el grant vivo se volvería una fuga.
--
-- QUÉ HACE: revoca ALL de `anon` en toda tabla public con RLS activa que NO
-- tenga NINGUNA policy que le aplique a anon (ni directa ni vía rol PUBLIC).
-- Dinámico + idempotente: en una BD nueva (default post-0130, sin el
-- over-grant) el loop no encuentra nada y es no-op.
--
-- QUÉ NO TOCA (se preservan intactas):
--   * Las 6 tablas de flujos públicos donde una policy NOMBRA a `anon`
--     (formularios/servicios/categorias_servicio/servicio_vouchers SELECT,
--     formulario_submissions/formulario_adjuntos INSERT) → los formularios
--     públicos, vouchers y verificación siguen funcionando.
--   * Las tablas con policy de rol PUBLIC gateada por is_staff()/owner
--     (audit_log, certificado_esquemas, errores_runtime, notificaciones_internas,
--     encuentro_sesiones_compartidas, vistas_guardadas): anon no las puede usar
--     (no pasa el USING), pero se dejan como estaban para cero riesgo.
--   * authenticated y service_role: NO se tocan (gerencia, portal cliente y
--     edge functions siguen igual).
--
-- Verificado en dry-run (BEGIN/rollback): revoca 102 tablas; los 6 flujos
-- públicos conservan su grant; tramites/comprobantes quedan sin anon.

DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid
          AND (p.polroles = '{0}'  -- rol PUBLIC (incluye anon)
               OR 'anon' = ANY (SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)))
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee = 'anon'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'mig 0284: revocado ALL de anon en % tablas internas', v_n;
END $$;

-- Smoke: los flujos públicos conservan su acceso; las internas quedan sin anon.
DO $$
BEGIN
  IF NOT has_table_privilege('anon','public.formularios','SELECT')
     OR NOT has_table_privilege('anon','public.servicios','SELECT')
     OR NOT has_table_privilege('anon','public.formulario_submissions','INSERT')
     OR NOT has_table_privilege('anon','public.formulario_adjuntos','INSERT')
     OR NOT has_table_privilege('anon','public.servicio_vouchers','SELECT') THEN
    RAISE EXCEPTION 'smoke 0284: se rompió un grant de flujo público de anon';
  END IF;
  IF has_table_privilege('anon','public.tramites','SELECT')
     OR has_table_privilege('anon','public.comprobantes','SELECT')
     OR has_table_privilege('anon','public.movimientos','SELECT')
     OR has_table_privilege('anon','public.administraciones','SELECT') THEN
    RAISE EXCEPTION 'smoke 0284: una tabla interna todavía tiene grant de anon';
  END IF;
  RAISE NOTICE 'smoke 0284 OK: flujos públicos intactos, internas sin anon';
END $$;
