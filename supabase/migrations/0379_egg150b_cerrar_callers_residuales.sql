-- ============================================================================
-- 0379 · E-GG-150b · Cerrar los 2 callers residuales del mismo vector
--         (hallazgo de la refutación adversarial de la mig 0378)
--
-- El fix 0378 cerró `encolar_email`, pero un barrido exhaustivo (refutador +
-- verificación propia) encontró 2 RPCs MÁS ejecutables por `authenticated`
-- que dejan el TEMPLATE en manos del caller y NO gatean por is_staff — el
-- mismo vector por otra puerta:
--
--  1. `public.lote_consolidado_administracion(uuid,text,jsonb)` — gateada
--     SÓLO por tenencia (assert_administracion_access). Un cliente
--     (administrador) no-staff, con SU admin, encola CUALQUIER template
--     activo con variables arbitrarias. El destino queda auto-dirigido a la
--     casilla de su propia administración (no puede editar
--     `administraciones.email` → RLS is_staff), así que NO es phishing a
--     terceros, pero es superficie residual. 0 callers en front/edge/SQL
--     (código muerto de cara a la app).
--  2. `public.notify_all_gerentes(...)` — `p_template_slug` controlable, sin
--     gate. Un cliente podría notificar a TODOS los gerentes con un template
--     arbitrario (spam interno, no a terceros). 0 callers directos en
--     front/edge; sus 5 callers son triggers/funciones SECDEF internas
--     (dispatch_alarmas_tracking_hoy, _notif_cobranza_recibida_trg,
--     _notif_tracking_cerrado_trg, tracking_linea_on_insert,
--     tramite_matricula_recordar_numero) que la ejecutan como OWNER.
--
-- FIX: REVOKE EXECUTE de ambas a authenticated+PUBLIC (queda service_role +
-- postgres/owner). Ambas son SECDEF owned by postgres → los callers internos
-- (triggers que un cliente dispara, crons) siguen intactos como owner; el
-- acceso DIRECTO por PostgREST del cliente queda cerrado. Simétrico con 0378.
--
-- Descartados en el barrido (NO son vector): private.next_email_slot (schema
-- private, no expuesto por PostgREST); solicitud_pedir_docs_revision /
-- solicitud_rechazar (ya gatean role='gerente' + template fijo);
-- tramite_pedido_doc_enviar_revision (flujo legítimo de cliente, template
-- fijo); trg_certificado_celebrar_fn (trigger, no invocable directo).
--
-- Verificado e2e (rollback): cliente no-staff no puede llamar ninguna de las
-- dos directo (42501); un trigger que usa notify_all_gerentes sigue
-- notificando (owner); service_role directo OK.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.lote_consolidado_administracion(uuid, text, jsonb)
  FROM authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.lote_consolidado_administracion(uuid, text, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.lote_consolidado_administracion(uuid, text, jsonb) IS
  'E-GG-150b: NO ejecutable por authenticated (template controlable sin gate is_staff). Sólo service_role + callers internos SECDEF como owner.';

REVOKE EXECUTE ON FUNCTION public.notify_all_gerentes(text, text, text, text, jsonb, boolean, text, jsonb, smallint, text, uuid)
  FROM authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_all_gerentes(text, text, text, text, jsonb, boolean, text, jsonb, smallint, text, uuid)
  TO service_role;
COMMENT ON FUNCTION public.notify_all_gerentes(text, text, text, text, jsonb, boolean, text, jsonb, smallint, text, uuid) IS
  'E-GG-150b: NO ejecutable por authenticated (notifica a gerentes con template controlable). Sólo callers internos SECDEF (triggers/crons) como owner + service_role.';

NOTIFY pgrst, 'reload schema';
