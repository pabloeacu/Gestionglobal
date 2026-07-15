-- 0350 · WAVE 7 · E-GG-129: la cobranza AUTOMÁTICA (cron dispatch-recupero, 12:30
-- diario, service_role) seguía MUERTA una capa más adentro de lo que arregló 0348.
--
-- CADENA DEL BUG (capturada por el QA blast-radius de wave 7, verificada e2e por
-- contraste rol-a-rol): 0348 arregló el guard SUPERIOR de disparar_recupero_manual
-- (is_staff → is_staff_or_service), así que el cron PASA ese guard. Pero
-- disparar_recupero_manual llama a public.encolar_email(..., administracion_id
-- NO-nulo, ...) y encolar_email ejecuta INCONDICIONALMENTE
-- private.assert_administracion_access(p_admin) antes de encolar. Ese assert tiene
-- 3 vías de escape: app.skip_admin_assert='on' | is_staff() | current_administracion_id()
-- =p_admin. Bajo service_role NINGUNA aplica (skip sin setear; is_staff()=false tras
-- 0346 NULL→false; current_administracion_id()=NULL sin auth.uid()) → RAISE 42501.
-- Resultado: el cron devuelve ok:true pero encolados=0, TODOS los morosos caen en
-- errores[], 0 recupero_acciones, 0 email_queue, comprobantes quedan en 'pendiente'.
-- Contraste e2e: con el JWT del gerente real la MISMA RPC corre completa
-- (recupero_acciones=1, email_queue=1, estado='en_recupero'). El circuito
-- STAFF/manual está OK; sólo el service_role/cron estaba roto.
--
-- FIX (misma palanca que 0348, una capa adentro): el assert de tenencia (regla 12)
-- reconoce al service_role como contexto de servidor de confianza — igual que ya lo
-- reconocen los guards de nivel superior. Cambiamos su rama is_staff() por
-- is_staff_or_service(). El service_role ya tiene god-mode (bypassa RLS y es
-- server-side, R3), así que dejarlo pasar la tenencia NO abre superficie nueva:
--   • staff → is_staff_or_service()=true → RETURN (idéntico a antes).
--   • service_role (edge/cron) → true → RETURN (FIX: el cron pasa la tenencia).
--   • cliente/administrador → false → cae al chequeo current_administracion_id()
--     =p_admin → RETURN sólo si es SU administración, si no RAISE (idéntico).
--   • anon → false + current=NULL → NULL=p_admin=NULL no matchea → RAISE (idéntico).

CREATE OR REPLACE FUNCTION private.assert_administracion_access(p_administracion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Bypass interno cuando una RPC SECURITY DEFINER trusted lo solicita.
  IF current_setting('app.skip_admin_assert', true) = 'on' THEN
    RETURN;
  END IF;
  -- E-GG-129: staff O service_role (edge/cron de confianza) pasan la tenencia.
  IF private.is_staff_or_service() THEN
    RETURN;
  END IF;
  IF private.current_administracion_id() = p_administracion_id THEN
    RETURN;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Acceso denegado a la administración solicitada.';
END;
$function$;
