-- 0283 · Blindaje (defensa en profundidad, línea E-GG-88/mig 0279): quitarle a
-- `anon` el SELECT DIRECTO sobre las tablas de pedidos de documentación.
--
-- Hallazgo de la §6 (pieza 2 de E-GG-91): `anon` conservaba un GRANT SELECT
-- directo a nivel tabla sobre tramite_pedidos_doc y _items, herencia del default
-- pre-0130 de Postgres (PUBLIC → anon). HOY no filtra nada (RLS activa, y las
-- policies son sólo para `authenticated` → sin policy para anon, PostgREST le
-- niega las filas), pero es exactamente el patrón "grant a quien nunca debe
-- llamar" que 0279 barrió en funciones y no en tablas. El gestor externo (anon)
-- lee estos docs SÓLO vía la RPC gestor_obtener_info_solicitud (SECURITY
-- DEFINER, corre como owner) → no necesita el grant directo. Verificado en §6:
-- ninguna función SECURITY INVOKER ejecutable por anon referencia estas tablas.
--
-- No toca authenticated/service_role (gerencia y cliente logueado siguen igual).
--
-- NOTA (§6): al medir se vio que anon tenía el set COMPLETO de privilegios
-- (SELECT/INSERT/UPDATE/DELETE/… = 12 grants sobre las 2 tablas), no sólo
-- SELECT — todo herencia del default PUBLIC pre-0130. Por eso el REVOKE es ALL.
-- (El cliente que sube docs está `authenticated`, no anon; no hay flujo anon de
-- escritura a estas tablas → seguro.) El barrido sistémico del mismo patrón en
-- OTRAS tablas queda como tarea de hardening aparte (línea E-GG-88).

REVOKE ALL ON public.tramite_pedidos_doc      FROM anon;
REVOKE ALL ON public.tramite_pedidos_doc_items FROM anon;

-- Smoke: confirmar que anon quedó sin ningún privilegio directo sobre ambas.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN ('tramite_pedidos_doc','tramite_pedidos_doc_items')
    AND grantee='anon';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'smoke 0283: anon todavía tiene % grant(s) directo(s) sobre las tablas _doc', v_n;
  END IF;
  RAISE NOTICE 'smoke 0283 OK: anon sin acceso directo a tramite_pedidos_doc(_items)';
END $$;
