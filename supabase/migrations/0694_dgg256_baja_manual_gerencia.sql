-- 0694_dgg256_baja_manual_gerencia.sql
-- =============================================================================
-- DGG-256 · Baja MANUAL desde gerencia (Captación PBA + Suscriptores LexPH).
--
-- Pedido Pablo (2026-11-16): cuando alguien pide la baja por fuera del link
-- self-service (WhatsApp/mail), gerencia necesita un botón para desafectar ese
-- email. Hoy la baja existe SOLO por token (self-service):
--   - prospectos: public.prospecto_baja(id, token)   (0545) — revocada de authenticated (0575)
--   - lexph:      public.lexph_suscripcion_baja(token) (0660)
-- Ambas hacen el MISMO doble efecto, que es lo que corta el envío por TODA vía:
--   (a) estado local -> 'baja' (coherencia de grilla/KPIs + filtro extra del newsletter)
--   (b) INSERT en public.email_suppression  (opt-out GLOBAL unificado; lo re-chequea
--       el cron de captación, el dispatcher y el envío de newsletter — fail-closed).
--
-- Acá agregamos las variantes STAFF (por id, SIN token, gate is_staff) que replican
-- EXACTO ese doble efecto. Aditivo: no se toca ninguna RPC/edge existente.
-- R5 (SECURITY DEFINER + search_path fijo) · R6 (REVOKE+GRANT explícitos) ·
-- R16 (nombres net-new -> 0 overloads) · R12 N/A (no hay p_administracion_id:
-- son operaciones de gerencia single-tenant; el gate correcto es is_staff()).
-- email_suppression.motivo/origen no tienen CHECK (son texto libre documentado);
-- usamos motivo='manual', origen='gerencia' para trazar que lo hizo el staff.
-- =============================================================================

-- (1) Captación PBA — baja manual por gerencia (gemela de prospecto_baja sin token)
CREATE OR REPLACE FUNCTION public.prospecto_baja_manual(p_prospecto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text; v_convertido timestamptz;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT email, convertido_at INTO v_email, v_convertido FROM public.prospectos WHERE id = p_prospecto_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_encontrado');
  END IF;
  -- Guard de defensa (§6 B#11): no suprimir por acá a un prospecto YA convertido en
  -- cliente — su email es el del cliente y la supresión global le apagaría el marketing
  -- (ofrecimientos/engagement). La UI ya oculta el botón, esto es el cinturón del RPC.
  IF v_convertido IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ya_convertido');
  END IF;
  INSERT INTO public.email_suppression (email, motivo, origen, prospecto_id)
  VALUES (lower(btrim(v_email)), 'manual', 'gerencia', p_prospecto_id)
  ON CONFLICT (email) DO NOTHING;
  UPDATE public.prospectos
     SET baja_at = COALESCE(baja_at, now()), estado_captacion = 'baja', updated_at = now()
   WHERE id = p_prospecto_id;
  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $fn$;
REVOKE ALL ON FUNCTION public.prospecto_baja_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospecto_baja_manual(uuid) TO authenticated;

-- (2) Suscriptores LexPH — baja manual por gerencia (gemela de lexph_suscripcion_baja sin token)
CREATE OR REPLACE FUNCTION public.lexph_suscripcion_baja_staff(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM public.lexph_suscriptores WHERE id = p_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_encontrado');
  END IF;
  UPDATE public.lexph_suscriptores
     SET estado = 'baja', baja_at = COALESCE(baja_at, now())
   WHERE id = p_id;
  -- supresión global (opt-out unificado): corta el envío por toda vía.
  INSERT INTO public.email_suppression (email, motivo, origen)
  VALUES (lower(btrim(v_email)), 'manual', 'gerencia')
  ON CONFLICT (email) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $fn$;
REVOKE ALL ON FUNCTION public.lexph_suscripcion_baja_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lexph_suscripcion_baja_staff(uuid) TO authenticated;
