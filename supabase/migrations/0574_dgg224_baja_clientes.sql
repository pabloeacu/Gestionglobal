-- 0574 · DGG-224 Fase 2 — Baja (opt-out) de marketing para CLIENTES.
--
-- Hasta ahora sólo los prospectos tenían link de baja. Un cliente no tenía forma
-- de auto-excluirse del marketing (motor de ofrecimientos). Esta mig agrega la
-- pieza de datos: token por administración + RPC de baja. El link en el mail y
-- el branch del edge email-baja van aparte (edges).
--
-- Semántica de la baja de cliente ("no recibir NADA de marketing"):
--   (1) email → email_suppression (lista global; el motor ya la respeta, DGG-224 F1),
--   (2) ofrecimientos_habilitados=false → corta TODOS los canales de marketing
--       (email+push+banner) para ese cliente.
--   El transaccional (comprobantes, tracking, reset de contraseña) NO mira ninguno
--   de los dos → sigue llegando normalmente.

-- 1) Token de baja por administración (unguessable, uno por cliente, siempre presente).
ALTER TABLE public.administraciones ADD COLUMN IF NOT EXISTS baja_token text;
UPDATE public.administraciones SET baja_token = gen_random_uuid()::text WHERE baja_token IS NULL;
ALTER TABLE public.administraciones ALTER COLUMN baja_token SET DEFAULT gen_random_uuid()::text;

-- 2) RPC de baja (espejo de prospecto_baja). SECDEF: la llama el edge email-baja
--    con service_role. Valida (admin, token) → suprime email + apaga marketing.
CREATE OR REPLACE FUNCTION public.administracion_baja(p_admin_id uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email
    FROM public.administraciones
   WHERE id = p_admin_id AND baja_token = p_token AND p_token IS NOT NULL AND btrim(p_token) <> '';
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalido');
  END IF;
  IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    INSERT INTO public.email_suppression (email, motivo, origen, prospecto_id)
    VALUES (lower(btrim(v_email)), 'baja_usuario', 'cliente', NULL)
    ON CONFLICT (email) DO NOTHING;
  END IF;
  UPDATE public.administraciones
     SET ofrecimientos_habilitados = false, updated_at = now()
   WHERE id = p_admin_id;
  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $function$;

-- R6/defensa: sólo el edge (service_role) la ejecuta. El token igual la protege,
-- pero cerramos la superficie.
REVOKE EXECUTE ON FUNCTION public.administracion_baja(uuid, text) FROM anon, authenticated;
