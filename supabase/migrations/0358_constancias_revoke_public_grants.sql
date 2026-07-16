-- 0358 · §6 CONST GAP-seguridad: REVOKE ALL ... FROM anon NO quita el grant
-- default EXECUTE→PUBLIC de Postgres, así que anon quedaba con EXECUTE sobre
-- emitir_constancia/constancia_registrar_pdf (el guard is_staff() igual bloquea,
-- pero por higiene/defensa en profundidad se revoca de PUBLIC como la gemela).
REVOKE ALL ON FUNCTION public.emitir_constancia(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.constancia_registrar_pdf(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emitir_constancia(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.constancia_registrar_pdf(uuid, text) TO authenticated, service_role;

-- §6 CONST GAP-seguridad #9: los default privileges del proyecto le dieron a
-- anon DML completo sobre la tabla + USAGE sobre la secuencia (las tablas
-- hermanas del diploma NO lo tienen). RLS lo deniega igual, pero se revoca para
-- respetar R6 ("anon sólo si el flujo público lo necesita" — acá no lo necesita).
REVOKE ALL ON TABLE public.constancias FROM anon;
REVOKE ALL ON SEQUENCE public.constancias_codigo_seq FROM anon;
