-- 0690 · DGG-249 · R10/seguridad: revocar EXECUTE a PUBLIC/anon en las RPC de egreso.
-- La auditoría final (advisor 0028/0029) detectó que emitir_egreso / registrar_pago_egreso /
-- anular_egreso / listar_egresos / revertir_pagos_egreso quedaron con el GRANT por defecto de
-- Postgres a PUBLIC (y anon por default-privileges de Supabase). Todas se auto-gatean con
-- private.is_staff() (anon → 42501, sin exposición de datos), pero el resto de las RPC de dinero
-- del proyecto (fz_anular_movimiento, pago_conciliar, partner_crear_rendicion, …) están concedidas
-- SÓLO a authenticated + service_role. Alineamos la postura (defense-in-depth + advisor limpio).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('emitir_egreso','registrar_pago_egreso','anular_egreso','listar_egresos','revertir_pagos_egreso')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;
