-- 0545_dgg220_email_suppression_baja.sql
-- =============================================================================
-- DGG-220 · Fase 2 — Compliance: supresión global por email + baja one-click.
-- GATE obligatorio antes de cualquier mailing en frío a prospectos (legal + reputación).
--
-- - `email_suppression`: lista de supresión por email (opt-out). Fuente única.
-- - `prospectos.baja_token`: token por prospecto para el link de baja (sin secreto).
-- - `prospecto_baja(id, token)`: RPC pública que procesa la baja (la llama el edge
--   `email-baja`, GET o List-Unsubscribe-Post one-click).
-- - `email_esta_suprimido(email)`: lo consulta `dispatch-emails` antes de enviar
--   (sólo para marketing a prospectos; lo transaccional no se toca).
-- =============================================================================

-- ---- Lista de supresión (opt-out global por email) ----
CREATE TABLE IF NOT EXISTS public.email_suppression (
  email       text PRIMARY KEY,                       -- normalizado lower(trim)
  motivo      text NOT NULL DEFAULT 'baja_usuario',   -- baja_usuario | bounce | queja | manual
  origen      text,                                   -- prospecto | cliente | manual | webhook
  prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_suppression ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppression TO authenticated;  -- R6, gestión staff
DROP POLICY IF EXISTS email_suppression_staff_all ON public.email_suppression;
CREATE POLICY email_suppression_staff_all ON public.email_suppression
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE INDEX IF NOT EXISTS idx_email_suppression_prospecto ON public.email_suppression(prospecto_id) WHERE prospecto_id IS NOT NULL;  -- R11

-- ---- Token de baja por prospecto (sin secreto; se valida contra la fila) ----
ALTER TABLE public.prospectos
  ADD COLUMN IF NOT EXISTS baja_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
-- (los prospectos existentes ya recibieron un token por el DEFAULT al agregar la columna NOT NULL)

-- ---- Chequeo de supresión (lo usa dispatch-emails y el motor; service_role) ----
CREATE OR REPLACE FUNCTION public.email_esta_suprimido(p_email text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.email_suppression s WHERE s.email = lower(btrim(p_email)));
$fn$;
REVOKE EXECUTE ON FUNCTION public.email_esta_suprimido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_esta_suprimido(text) TO authenticated, service_role;

-- ---- Procesar la baja (la llama el edge email-baja; pública con token) ----
CREATE OR REPLACE FUNCTION public.prospecto_baja(p_prospecto_id uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email
    FROM public.prospectos
   WHERE id = p_prospecto_id AND baja_token = p_token AND p_token IS NOT NULL AND btrim(p_token) <> '';
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalido');
  END IF;
  INSERT INTO public.email_suppression (email, motivo, origen, prospecto_id)
  VALUES (lower(btrim(v_email)), 'baja_usuario', 'prospecto', p_prospecto_id)
  ON CONFLICT (email) DO NOTHING;
  UPDATE public.prospectos
     SET baja_at = COALESCE(baja_at, now()), estado_captacion = 'baja', updated_at = now()
   WHERE id = p_prospecto_id;
  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospecto_baja(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prospecto_baja(uuid, text) TO anon, authenticated, service_role;  -- público (baja one-click)

-- ---- Hardening §6 B#3b (least-privilege R6): sacar los GRANTs legacy de `anon`
-- sobre las tablas nuevas de DGG-220 (RLS ya las protege, pero higiene). ----
REVOKE ALL ON public.email_suppression FROM anon;
REVOKE ALL ON public.prospecto_padron FROM anon;
REVOKE ALL ON public.prospecto_tramix_queue FROM anon;
