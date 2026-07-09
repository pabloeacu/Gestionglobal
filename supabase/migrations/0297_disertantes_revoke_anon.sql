-- 0297 · Fix over-grant anon en public.disertantes (hallazgo §6 e2e).
-- La tabla se creó en 0293 con `GRANT ... TO authenticated`, pero como el
-- proyecto es pre-0130 el `CREATE TABLE` ya había concedido TODO a PUBLIC (que
-- incluye anon). RLS la tapa (única policy es `FOR ALL TO authenticated`), pero
-- el grant a anon es una sobre-exposición que contradice R6 y el sweep E-GG-92
-- (mig 0284). Defense-in-depth: revocar anon explícitamente, como el resto de
-- las tablas internas/staff-only.
REVOKE ALL ON TABLE public.disertantes FROM anon;
REVOKE ALL ON TABLE public.disertantes FROM PUBLIC;

-- El trigger fn de updated_at también quedó con EXECUTE a PUBLIC por default.
-- No es alcanzable por PostgREST (retorna `trigger`), pero lo revocamos por
-- consistencia con el sweep de funciones internas.
REVOKE EXECUTE ON FUNCTION public.tg_disertantes_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_disertantes_updated_at() FROM PUBLIC;
