-- 0475 · Auditoría 2026-09 · C1 (CRÍTICO): cierre de escalada de privilegios en profiles
--
-- HALLAZGO (verificado e2e, baseline PRE-fix):
--   El rol `authenticated` tenía UPDATE a nivel TABLA sobre public.profiles, es
--   decir sobre TODAS las columnas incluidas `role`, `administracion_id`,
--   `partner_id` y `activo`. La única policy de write es `profiles_update_self`
--   (USING/WITH CHECK id = auth.uid()) SIN restricción de columnas. Combinado:
--   cualquier usuario logueado podía ejecutar
--       UPDATE public.profiles SET role='gerente' WHERE id = auth.uid();
--   y autoconvertirse en STAFF (gerente) — o secuestrar su tenancy cambiando
--   `administracion_id`, o reactivarse tras una baja cambiando `activo`.
--   (RLS ya aislaba filas ajenas: H12 confirmó 0 filas ajenas afectadas. El
--    hueco era exclusivamente la ausencia de restricción de columna.)
--
-- CAUSA RAÍZ (T1 de la auditoría): el default de Supabase otorga privilegios
--   amplios; el aislamiento single-tenant depende de guards internos, pero la
--   escritura self-service de perfil quedó como UPDATE de tabla completa.
--
-- FIX: revocar el UPDATE de tabla y otorgar UPDATE SÓLO sobre las 3 columnas
--   que el front escribe legítimamente en autoservicio. Inventario exhaustivo
--   del front (grep total de .from('profiles') + .update/.upsert):
--     · src/services/api/profiles.ts:62  -> UPDATE {full_name, phone, avatar_url}
--     · src/services/api/perfil.ts:33     -> UPDATE {full_name, phone, avatar_url}
--     · el resto son SELECT.
--   Columnas escritas por OTRAS vías (NO necesitan grant a authenticated):
--     · pwa_installed_at / pwa_last_seen_at -> RPC gg_profile_marcar_pwa (SECURITY DEFINER, owner postgres)
--     · onboarding_checklist                -> RPC onboarding_checklist_set   (SECURITY DEFINER, owner postgres)
--     · updated_at                          -> trigger BEFORE UPDATE trg_profiles_touch (no requiere privilegio de columna del invoker)
--     · role/administracion_id/partner_id/activo -> sólo edge fns (service_role) y RPCs SECURITY DEFINER de gerencia
--   service_role NO se toca (BYPASSRLS + grants propios): crear-gerente,
--   alta-cliente-portal y demás edge fns siguen operando con normalidad.
--
-- RIESGO DE IMPLEMENTACIÓN: mínimo. No hay caller de front que escriba columnas
--   fuera del whitelist; los flujos de gerencia (cambios de rol/estado) van por
--   RPC SECURITY DEFINER o edge fns con service_role, ambos ajenos a este grant.
--
-- SMOKE (R18) — 15 hipótesis e2e con impersonación de authenticated + rollback
--   forzado; corrido antes (baseline vulnerable) y después (todo bloqueado /
--   self-service intacto). Resultado post-fix documentado en el chunk.

REVOKE UPDATE ON public.profiles FROM authenticated;

-- Defensa en profundidad: revoca explícitamente cualquier grant de columna
-- sensible que pudiera existir por fuera del grant de tabla.
REVOKE UPDATE (role, administracion_id, partner_id, activo, updated_at,
               created_at, id, onboarding_checklist,
               pwa_installed_at, pwa_last_seen_at)
  ON public.profiles FROM authenticated;

-- Autoservicio de perfil: SÓLO estas 3 columnas.
GRANT UPDATE (full_name, phone, avatar_url) ON public.profiles TO authenticated;

COMMENT ON POLICY profiles_update_self ON public.profiles IS
  'Autoservicio de perfil. La restricción de columnas (full_name/phone/avatar_url) '
  'se aplica por GRANT de columna a authenticated (mig 0475, C1). role/administracion_id/'
  'partner_id/activo sólo mutan via RPC SECURITY DEFINER o edge fns service_role.';
