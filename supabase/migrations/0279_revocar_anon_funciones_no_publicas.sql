-- 0279 · E-GG-88 · Higiene de permisos: revocar `anon` de funciones no-públicas
-- ============================================================================
-- Auditoría de seguridad (reels que mandó Pablo, punto RLS/autorización): por el
-- grant por defecto de Postgres a PUBLIC, ~30 funciones SECURITY DEFINER quedaban
-- invocables por `anon` (sin login). La MAYORÍA ya rebotan (tienen guard is_staff/
-- tenancy/rol), así que no había fuga; pero es defensa en profundidad revocar el
-- acceso de quien nunca debe llamarlas. Se REVOKE ... FROM PUBLIC (saca anon) y se
-- re-otorga sólo al rol que sí las usa, para no romper ningún flujo:
--   · auth_only    → gerencia logueada (authenticated) + service_role.
--   · service_only → webhooks Webex (los llama la edge fn webex-webhook con
--                    service_role; NUNCA anon).
--   · internal_only→ funciones de trigger + el batch de cron (corre como postgres):
--                    nadie las llama por /rpc.
-- Se DEJAN intactas las genuinamente públicas (verificar_certificado, voucher_validar,
-- get_public_whatsapp, catálogo de formularios, webinar, y el flujo de gestoría por
-- token) y voucher_incrementar_uso (la llama el front). Idempotente.
-- ============================================================================
DO $$
DECLARE
  r record;
  sig text;
  auth_only text[] := ARRAY[
    'arca_emisor_default','arca_emisor_set_default','cert_marcar_celebracion_vista',
    'cuenta_corriente_resumen_global','db_health_metrics','tracking_cerrar','tracking_reabrir',
    'cuenta_corriente_resumen','solicitud_pedir_docs_revision'
  ];
  service_only text[] := ARRAY[
    'webex_encuentro_started','webex_encuentro_ended','webex_participant_joined','webex_participant_left'
  ];
  internal_only text[] := ARRAY[
    'gg_campus_vencer_matriculas',
    '_audit_log_trg','_notif_cobranza_recibida_trg','_notif_solicitud_nueva_trg','_notif_tracking_cerrado_trg',
    'sync_submission_a_administracion','tramite_cerrar_exige_cobrado','tramite_matricula_recordar_numero',
    'trg_certificado_celebrar_fn','trg_certificado_cierra_tramite_curso_fn',
    'trg_imp_validar_sum_no_supera_monto','trg_imp_validar_sum_no_supera_total'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname = ANY(auth_only) OR p.proname = ANY(service_only) OR p.proname = ANY(internal_only))
  LOOP
    sig := r.oid::regprocedure::text;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    IF r.proname = ANY(auth_only) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', sig);
    ELSIF r.proname = ANY(service_only) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END IF;
  END LOOP;
END $$;
