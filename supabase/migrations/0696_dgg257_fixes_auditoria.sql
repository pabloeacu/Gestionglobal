-- 0696_dgg257_fixes_auditoria.sql
-- =============================================================================
-- Fixes de la doble auditoría §6 del chunk DGG-257 (reactivar manual). Todos
-- in-chunk y aditivos. Ver DGG-257 / E-GG-282.
--
-- (A) §6-e "aviso sorpresa": trg_lexph_suscriptor_confirmado mandaba la campanita
--     "X se sumó al newsletter" a gerencia también en una REACTIVACIÓN (baja→
--     confirmado), mintiendo (no es un alta nueva). Se agrega guarda para no
--     avisar cuando OLD.estado='baja'. Preserva altas/confirmaciones genuinas.
-- (#12) DRY: el set de motivos "duros" (casilla muerta) estaba hardcodeado en 3
--     lugares sobre un `motivo` sin CHECK → riesgo de drift. Se extrae
--     private.motivo_es_hard(text) y lo consumen las 2 guardas de reactivar.
--     email_bloqueado_total NO se refactoriza acá: tiene su propio carve-out
--     (origen='webhook' AND cliente activo) que las guardas de botón a propósito
--     NO replican (son conservadoras: ante casilla muerta derivan a "Correos
--     suprimidos"). Ver #11 de la auditoría.
-- (#6) Robustez: los wrappers de reactivar propagan el {ok:false} real de
--     email_reactivar (p.ej. 'email_vacio') en vez de reportar éxito.
-- =============================================================================

-- (#12) helper único del set "duro" (casilla muerta)
CREATE OR REPLACE FUNCTION private.motivo_es_hard(p_motivo text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT p_motivo IN ('bounce', 'queja', 'descartado_gerencia', 'invalida');
$fn$;

-- (A) trigger: no avisar "se sumó" en una reactivación (baja→confirmado)
CREATE OR REPLACE FUNCTION public.lexph_suscriptor_confirmado_trg()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
begin
  if NEW.estado = 'confirmado'
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'confirmado')
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'baja')  -- DGG-257: no avisar reactivaciones
     and coalesce(NEW.origen, '') not in ('cliente', 'captacion')
  then
    perform private.notif_emitir_staff(
      'lexph_suscriptor',
      'Nuevo suscriptor de LexPH',
      NEW.email || ' se sumó al newsletter.',
      '/gerencia/contenidos/suscriptores',
      jsonb_build_object('suscriptor_id', NEW.id, 'email', NEW.email, 'origen', NEW.origen)
    );
  end if;
  return NEW;
end;
$fn$;

-- (#12 + #6) wrappers de reactivar: usan el helper y propagan el error real.
CREATE OR REPLACE FUNCTION public.prospecto_reactivar_manual(p_prospecto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_email text; v_motivo text; v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO v_email FROM public.prospectos WHERE id = p_prospecto_id;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_encontrado'); END IF;
  SELECT motivo INTO v_motivo FROM public.email_suppression WHERE email = lower(btrim(v_email));
  IF private.motivo_es_hard(v_motivo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bloqueo_duro', 'motivo', v_motivo);
  END IF;
  v_res := public.email_reactivar(v_email);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  RETURN jsonb_build_object('ok', true, 'email', v_email, 'detalle', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.prospecto_reactivar_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospecto_reactivar_manual(uuid) TO authenticated;

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
  IF private.motivo_es_hard(v_motivo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bloqueo_duro', 'motivo', v_motivo);
  END IF;
  v_res := public.email_reactivar(v_email);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  RETURN jsonb_build_object('ok', true, 'email', v_email, 'detalle', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.lexph_suscripcion_reactivar_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lexph_suscripcion_reactivar_staff(uuid) TO authenticated;
