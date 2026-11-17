-- 0695_dgg257_reactivar_manual_gerencia.sql
-- =============================================================================
-- DGG-257 · Reactivar MANUAL desde gerencia (Captación PBA + Suscriptores LexPH).
-- Es el INVERSO de la baja de DGG-256 (mig 0694) y cierra E-GG-281 (el reverso
-- faltante: devolver un email a los envíos de forma COHERENTE en TODAS las
-- superficies, no sólo en el panel donde se clickea — igual que la baja es global).
--
-- Pedido Pablo (2026-11-17): "Agregá el botón reactivar en los dos paneles."
--
-- Fan-out auditado (§6 2-bis·a) — cómo elige destinatarios cada canal:
--   · Captación (prospectos_enviar_campana): baja_at IS NULL AND NOT email_esta_suprimido(email)
--   · LexPH    (lexph_newsletter_enviar):    estado='confirmado' AND NOT (email_suppression)
--   ⇒ para reanudar HAY que limpiar baja_at + supresión (captación) y estado +
--     supresión (LexPH). `email_reactivar` (DGG-224) ya hacía prospectos
--     (baja_at=NULL, estado='contactado') + administraciones (ofrecimientos) +
--     DELETE supresión, pero NO tocaba lexph_suscriptores → el newsletter NO se
--     reanudaba (quedaba estado='baja'). Esa era la pieza que faltaba.
--
-- (1) EXTENDER email_reactivar: además des-baja lexph_suscriptores. Misma firma
--     (R16: CREATE OR REPLACE → 0 overloads). Mejora de paso al panel
--     "Correos suprimidos" (DGG-224) que ya la llama. Resto INTACTO.
-- (2) Dos RPC net-new STAFF por-id (gemelas de las bajas de 0694), con GUARDA DE
--     BLOQUEO DURO: si la supresión del email es casilla muerta
--     (bounce/queja/invalida/descartado_gerencia) NO se reactiva desde el botón
--     — protege la reputación (no re-mandar a algo que rebota/se quejó) y deriva
--     al panel "Correos suprimidos", que SÍ permite el override consciente. El
--     caso típico (baja por link/manual = motivo 'baja_usuario'/'manual' = soft)
--     pasa la guarda sin problema.
--
-- R5 (SECDEF + search_path) · R6 (REVOKE+GRANT) · R16 (net-new, 0 overloads) ·
-- R12 N/A (sin p_administracion_id; el gate correcto es is_staff).
-- =============================================================================

-- (1) email_reactivar — + reset de lexph_suscriptores (aditivo; resto idéntico).
CREATE OR REPLACE FUNCTION public.email_reactivar(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_sup int; v_cli int; v_pro int; v_lex int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501'; END IF;
  IF v_email = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'email_vacio'); END IF;

  DELETE FROM public.email_suppression WHERE email = v_email;
  GET DIAGNOSTICS v_sup = ROW_COUNT;

  UPDATE public.administraciones
     SET ofrecimientos_habilitados = true, updated_at = now()
   WHERE lower(email) = v_email AND estado <> 'baja' AND ofrecimientos_habilitados = false;
  GET DIAGNOSTICS v_cli = ROW_COUNT;

  UPDATE public.prospectos
     SET estado_captacion = 'contactado', baja_at = NULL, updated_at = now()
   WHERE lower(btrim(email)) = v_email AND estado_captacion = 'baja';
  GET DIAGNOSTICS v_pro = ROW_COUNT;

  -- DGG-257 · pieza que faltaba: des-bajar el suscriptor del newsletter LexPH.
  -- El envío filtra estado='confirmado' AND NOT suprimido; sin esto, borrar la
  -- supresión no reanudaba el newsletter (seguía en 'baja').
  UPDATE public.lexph_suscriptores
     SET estado = 'confirmado', baja_at = NULL, confirmed_at = COALESCE(confirmed_at, now())
   WHERE lower(btrim(email)) = v_email AND estado = 'baja';
  GET DIAGNOSTICS v_lex = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'email', v_email,
    'supresiones_borradas', v_sup, 'clientes_reactivados', v_cli,
    'prospectos_reactivados', v_pro, 'lexph_reactivados', v_lex);
END $fn$;

-- (2a) Captación PBA — reactivar manual por gerencia (gemela de prospecto_baja_manual).
CREATE OR REPLACE FUNCTION public.prospecto_reactivar_manual(p_prospecto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text; v_motivo text; v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO v_email FROM public.prospectos WHERE id = p_prospecto_id;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_encontrado'); END IF;
  -- Guarda de bloqueo duro: casilla muerta no se reactiva desde el botón (reputación).
  SELECT motivo INTO v_motivo FROM public.email_suppression WHERE email = lower(btrim(v_email));
  IF v_motivo IN ('bounce', 'queja', 'descartado_gerencia', 'invalida') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bloqueo_duro', 'motivo', v_motivo);
  END IF;
  v_res := public.email_reactivar(v_email);   -- lift global + todas las superficies
  RETURN jsonb_build_object('ok', true, 'email', v_email, 'detalle', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.prospecto_reactivar_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospecto_reactivar_manual(uuid) TO authenticated;

-- (2b) LexPH — reactivar manual por gerencia (gemela de lexph_suscripcion_baja_staff).
CREATE OR REPLACE FUNCTION public.lexph_suscripcion_reactivar_staff(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text; v_motivo text; v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO v_email FROM public.lexph_suscriptores WHERE id = p_id;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_encontrado'); END IF;
  SELECT motivo INTO v_motivo FROM public.email_suppression WHERE email = lower(btrim(v_email));
  IF v_motivo IN ('bounce', 'queja', 'descartado_gerencia', 'invalida') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bloqueo_duro', 'motivo', v_motivo);
  END IF;
  v_res := public.email_reactivar(v_email);
  RETURN jsonb_build_object('ok', true, 'email', v_email, 'detalle', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.lexph_suscripcion_reactivar_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lexph_suscripcion_reactivar_staff(uuid) TO authenticated;
