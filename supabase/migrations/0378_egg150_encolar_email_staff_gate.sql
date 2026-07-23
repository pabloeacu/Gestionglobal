-- ============================================================================
-- 0378 · E-GG-150 · Cierre del vector de encolar_email (hallazgo de la
--         refutación §6 de DGG-115b, adyacencia #2)
--
-- PROBLEMA: `public.encolar_email` (mig 0024) tiene GRANT EXECUTE a
-- `authenticated` y su único gate (assert_administracion_access) SÓLO corre
-- si `p_administracion_id` es NOT NULL. Con admin NULL, cualquier usuario
-- logueado — CLIENTE (administrador), PARTNER, ALUMNO, no sólo gerencia —
-- puede, manipulando las peticiones (no desde la UI normal), encolar
-- CUALQUIER template activo hacia CUALQUIER email con variables/CTA
-- arbitrarios. Dos abusos: (a) phishing con el branding real de Gestión
-- Global (el correo sale del servidor oficial); (b) envenenar el dedupe de
-- algunos crons pre-insertando la clave de "ya avisé" para SUPRIMIR un aviso
-- legítimo. Es PRE-EXISTENTE (0024); DGG-115b ya dejó de depender de esta
-- función (mig 0377, INSERT directo).
--
-- MAPA DE CALLERS (auditado en BD viva antes de tocar nada):
--  · Front (superficie viva): SÓLO `EmailTemplatesPage` (gerencia · Config)
--    vía sendTestEmail → encolarEmail → rpc('encolar_email'). Es el ÚNICO
--    consumidor directo del GRANT a authenticated.
--  · 17 RPCs/triggers SECURITY DEFINER internos (curso_matricular,
--    emitir_certificado[_webinar], solicitud_*, tracking_*, comunicacion_
--    enviar, tg_webinar_token_bienvenida, trg_certificado_celebrar_fn, etc.)
--    → TODOS SECDEF owned by postgres: ejecutan encolar_email con privilegio
--    del OWNER, NO del invocador. NO dependen del GRANT a authenticated.
--    (Los guards internos ya son is_staff/is_staff_or_service donde
--    corresponde; los flujos que un cliente dispara —tracking_linea_on_insert,
--    bienvenida de webinar, celebración de certificado— son triggers SECDEF
--    y siguen intactos.)
--  · Crons SQL (gg_webinars_disparar_recordatorios) → corren como postgres
--    (owner), y además pasan admin NULL. Intactos.
--  · Edge functions → service_role (mantiene el GRANT). dispatch-vencimientos
--    reimplementa la lógica en JS, no llama la RPC.
--
-- FIX QUIRÚRGICO (cero lógica de negocio tocada):
--  1. Wrapper `public.gerencia_encolar_email(...)` = misma firma, guard
--     is_staff_or_service, delega en encolar_email. GRANT a authenticated:
--     sólo gerencia (o service) pasa; un cliente/partner/alumno es rechazado
--     con 42501. El front de gerencia lo usa en vez de encolar_email.
--  2. REVOKE EXECUTE de encolar_email a authenticated y PUBLIC. Queda
--     postgres + service_role. Los 17 internos SECDEF siguen (owner); las
--     edge/cron con service_role siguen; el cliente pierde el acceso directo.
--  3. El INSERT directo a email_queue por un cliente ya estaba cerrado por
--     RLS (email_queue_insert_staff · with_check is_staff) → el vector de
--     dedupe-poison queda sin superficie.
--
-- Verificado e2e (rollback): cliente directo DENEGADO, cliente al wrapper
-- DENEGADO, gerente al wrapper OK, cliente disparando trigger interno OK,
-- service_role directo OK. R16: sin overloads (firmas idénticas, wrapper es
-- nombre nuevo).
-- ============================================================================

-- ── 1 · Wrapper staff-gated para el front de gerencia ────────────────────────
CREATE OR REPLACE FUNCTION public.gerencia_encolar_email(
  p_template text,
  p_to_email text,
  p_to_nombre text,
  p_variables jsonb,
  p_administracion_id uuid,
  p_consorcio_id uuid,
  p_related_table text,
  p_related_id uuid,
  p_prioridad smallint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Sólo gerencia/operación (o service). Un cliente/partner/alumno logueado
  -- NO puede encolar templates arbitrarios (cierre del vector E-GG-150).
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'Solo gerencia puede encolar correos manualmente'
      USING ERRCODE = '42501';
  END IF;
  -- Delega en la función canónica (mantiene template-check + tenancy).
  RETURN public.encolar_email(
    p_template, p_to_email, p_to_nombre, p_variables,
    p_administracion_id, p_consorcio_id, p_related_table, p_related_id,
    p_prioridad
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gerencia_encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerencia_encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  TO authenticated, service_role;

-- ── 2 · Cerrar el acceso directo de authenticated a encolar_email ────────────
REVOKE EXECUTE ON FUNCTION public.encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  FROM authenticated, PUBLIC;
-- service_role (edge/cron) y postgres (owner → callers internos SECDEF)
-- conservan EXECUTE. Reafirmamos service_role por claridad.
GRANT EXECUTE ON FUNCTION public.encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  TO service_role;

COMMENT ON FUNCTION public.encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint) IS
  'E-GG-150: NO ejecutable por authenticated (sólo service_role + callers internos SECDEF como owner). Gerencia encola vía public.gerencia_encolar_email (staff-gated).';

-- ── 3 · Recargar el schema cache de PostgREST ────────────────────────────────
NOTIFY pgrst, 'reload schema';
