-- ============================================================================
-- 0420 · §6 DGG-134 — El trigger de vincular era código muerto en el path real
--
-- Hallazgo de la auditoría del chunk (falso verde del e2e — lección E-GG-42
-- repetida: simulé el orden a mano en vez de ejecutar la RPC real):
-- `solicitud_activar` marca la submission 'procesado' ANTES de escribir
-- solicitudes.cliente_id → trg_subm_vincular_admin leía NULL y no vinculaba
-- jamás en el flujo real. La ficha igual se capturaba (trg_tramite_backfill_
-- admin corre en el INSERT del trámite, misma transacción), pero la
-- vinculación de la submission — el hueco que DGG-134 vino a cerrar — no.
--
-- Fix quirúrgico (sin tocar solicitud_activar): fallback — si la solicitud
-- aún no tiene cliente_id, se resuelve por el TRÁMITE de la submission, que
-- en ese punto de solicitud_activar ya existe con administracion_id seteado.
--
-- R16: misma firma () → CREATE OR REPLACE sin overload. R18: smoke al cierre
-- ejecutando solicitud_activar REAL con rollback (no simulación manual).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subm_vincular_admin_al_procesar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT s.cliente_id INTO v_admin
  FROM public.solicitudes s
  WHERE s.formulario_submission_id = NEW.id AND s.cliente_id IS NOT NULL
  ORDER BY s.created_at DESC LIMIT 1;
  -- 0420: en el flujo real de solicitud_activar la submission pasa a
  -- 'procesado' ANTES de que la solicitud reciba cliente_id — pero el
  -- trámite (con administracion_id) ya existe. Fallback por ahí.
  IF v_admin IS NULL THEN
    SELECT t.administracion_id INTO v_admin
    FROM public.tramites t
    WHERE t.formulario_submission_id = NEW.id AND t.administracion_id IS NOT NULL
    ORDER BY t.created_at DESC LIMIT 1;
  END IF;
  IF v_admin IS NOT NULL THEN
    UPDATE public.formulario_submissions
       SET administracion_id = v_admin
     WHERE id = NEW.id AND administracion_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.subm_vincular_admin_al_procesar() FROM PUBLIC, anon, authenticated;
