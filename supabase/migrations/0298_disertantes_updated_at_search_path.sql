-- 0298 · Hardening (advisor "Function Search Path Mutable", hallazgo §6).
-- El trigger fn de updated_at de disertantes (0293) quedó sin search_path fijo.
-- Sólo llama now() (pg_catalog), así que el riesgo es nulo, pero el estándar del
-- repo es pinnearlo en TODA función. `SET search_path = ''` es lo más hardened.
CREATE OR REPLACE FUNCTION public.tg_disertantes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

-- CREATE OR REPLACE re-concede EXECUTE a PUBLIC por default → re-revocar (0297).
REVOKE EXECUTE ON FUNCTION public.tg_disertantes_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_disertantes_updated_at() FROM PUBLIC;
