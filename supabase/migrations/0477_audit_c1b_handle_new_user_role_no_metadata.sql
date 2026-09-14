-- 0477 · Auditoría 2026-09 · C1-b (CRÍTICO): handle_new_user confiaba en el rol
-- provisto por el cliente → auto-escalada a STAFF vía signup.
--
-- HALLAZGO (revisión adversarial de C1; verificado e2e + settings de Auth en vivo):
--   public.handle_new_user() (trigger AFTER INSERT en auth.users) hacía:
--     role = COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'administrador')
--   `raw_user_meta_data` lo controla el cliente en POST /auth/v1/signup (con la anon
--   key, que es pública). `GET /auth/v1/settings` en prod devuelve `disable_signup:
--   false` → el signup público está HABILITADO. Por lo tanto CUALQUIERA podía
--   registrarse con user_metadata {"role":"gerente"}, confirmar su propio email y
--   loguearse como STAFF (private.is_staff() lee profiles.role). Es el MISMO objetivo
--   que C1 (mig 0475) pero por otra vía: C1 cerró el UPDATE; esto cierra el INSERT.
--   Baseline verificado: INSERT sintético en auth.users con metadata role='gerente'
--   → profiles.role='gerente'.
--
-- FIX: NUNCA leer el rol del metadata. Forzar SIEMPRE 'administrador' (menor
--   privilegio). El staff/operador/partner se crea SÓLO por las edge fns
--   crear-gerente / alta-cliente-portal (service_role), que UPSERTEAN el rol correcto
--   DESPUÉS de este trigger (verificado: ambas hacen upsert explícito de role tras
--   createUser) → no hay regresión en la creación legítima de staff. Un signup abierto
--   queda como 'administrador' sin administracion_id = cuenta huérfana SIN privilegios
--   (RLS exige administracion_id; is_staff()=false). Cambio mínimo: sólo la línea del
--   rol; full_name se mantiene igual.
--
-- DEFENSA EN PROFUNDIDAD PENDIENTE (para Pablo, panel de Supabase): además de este
--   fix conviene poner disable_signup=true en Auth (la app no usa signup público;
--   todos los usuarios se crean por edge fn). Este trigger cierra la ESCALADA aunque
--   el signup siga abierto; deshabilitarlo además evita cuentas basura.
--
-- SMOKE (R18): tests e2e con INSERT sintético en auth.users (metadata role gerente/
--   operador/superadmin/none) + verificación de que profiles.role queda 'administrador'
--   + simulación del flujo crear-gerente (upsert posterior a 'gerente' sí pega),
--   todo con ROLLBACK forzado.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- SEGURIDAD (C1-b): jamás confiar en raw_user_meta_data->>'role' (lo controla el
  -- cliente en /auth/v1/signup). Rol de menor privilegio por defecto; el staff se
  -- setea explícitamente por las edge fns service_role DESPUÉS de este trigger.
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'administrador',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
