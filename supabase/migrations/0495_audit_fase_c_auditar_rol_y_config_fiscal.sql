-- 0495 · Auditoría 2026-09 · FASE C / C3: auditar cambios de ROL y de CONFIG FISCAL.
--
-- Hallazgo A5 del informe: la bitácora unificada (audit_log, DGG-175) cubre 17 tablas
-- pero NO `profiles` (cambios de rol → la superficie de la escalada C1) ni `config_global`
-- (datos fiscales del emisor). Ante una disputa o un incidente de seguridad, un cambio de
-- rol o de CUIT/certs no dejaba rastro en la bitácora que ve gerencia.
--
-- Fix (aditivo, reusa el trigger genérico _audit_log_trg — SECURITY DEFINER, R17, ya
-- probado en las 17 tablas): agrega auditoría a las dos tablas faltantes.
--
-- profiles: se auditan INSERT/DELETE (alta/baja de usuario) SIEMPRE, y los UPDATE SÓLO
-- cuando cambian columnas de privilegio (role/administracion_id/partner_id) — así la
-- bitácora captura la forense de escalada de C1 SIN ruido de pwa_last_seen_at/avatar/
-- onboarding (que se tocan seguido). Es el complemento observacional del belt de Fase A
-- (0492): el belt PREVIENE la escalada por usuario final; esto la REGISTRA venga de donde
-- venga (incluso de una RPC SECURITY DEFINER legítima o del service_role).
--
-- config_global: singleton (1 fila) que rara vez cambia → se audita todo (INSERT/UPDATE/DELETE).
--
-- Cero impacto funcional: son triggers AFTER que sólo INSERTAN en audit_log; no alteran
-- NEW/OLD ni bloquean nada. Reversible: DROP TRIGGER de los tres.

-- profiles · alta/baja: siempre
DROP TRIGGER IF EXISTS trg_audit_profiles_ins_del ON public.profiles;
CREATE TRIGGER trg_audit_profiles_ins_del
  AFTER INSERT OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();

-- profiles · update: sólo si cambia un privilegio (role/administracion_id/partner_id)
DROP TRIGGER IF EXISTS trg_audit_profiles_priv_upd ON public.profiles;
CREATE TRIGGER trg_audit_profiles_priv_upd
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role
        OR OLD.administracion_id IS DISTINCT FROM NEW.administracion_id
        OR OLD.partner_id IS DISTINCT FROM NEW.partner_id)
  EXECUTE FUNCTION public._audit_log_trg();

-- config_global · todo (singleton, cambios fiscales)
DROP TRIGGER IF EXISTS trg_audit_config_global ON public.config_global;
CREATE TRIGGER trg_audit_config_global
  AFTER INSERT OR UPDATE OR DELETE ON public.config_global
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
