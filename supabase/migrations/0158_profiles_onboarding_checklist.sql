-- 0158_profiles_onboarding_checklist · J1
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.onboarding_checklist IS
  'Checklist "Primeros 5 minutos" del gerente (J1). Keys: crear_cliente, registrar_tramite, ver_agenda, configurar_email, instalar_pwa, dismissed.';

CREATE OR REPLACE FUNCTION public.onboarding_checklist_set(p_key text, p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.profiles
    SET onboarding_checklist = onboarding_checklist || jsonb_build_object(p_key, p_value)
    WHERE id = v_uid
    RETURNING onboarding_checklist INTO v_new;
  RETURN COALESCE(v_new, '{}'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.onboarding_checklist_set(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_checklist_set(text, boolean) TO authenticated;
