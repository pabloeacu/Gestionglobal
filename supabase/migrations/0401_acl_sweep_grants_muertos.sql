-- ============================================================================
-- 0401 · DGG-125 — ACL sweep: revocar grants heredados MUERTOS (anon/authenticated)
--
-- Origen: hallazgo de DGG-120 (default ACL del schema public regala TODOS los
-- privilegios a anon/authenticated en cada tabla nueva) + chip de tarea
-- "revisar grants heredados" (pagos_reportados con ALL para anon).
--
-- REGLA DE ORO (riesgo funcional ~cero): solo se revoca lo que RLS ya bloquea
-- hoy — un privilegio sin policy del comando para ese rol es INUSABLE, así
-- que quitarlo no puede romper ningún flujo vivo. Además:
--  · REFERENCES / TRIGGER / TRUNCATE se revocan SIEMPRE (jamás usables desde
--    el cliente; TRUNCATE ni siquiera respeta RLS).
--  · SELECT de authenticated se CONSERVA aunque no haya policy (devuelve 0
--    filas; revocarlo convertiría "vacío" en error 42501 en algún query
--    residual) — salvo en tramix_* (caches de edge functions, sin ningún uso
--    en el front, verificado por auditoría).
--  · Las policies TO public cuentan para ambos roles; polcmd ALL cubre los 4
--    comandos. service_role no se toca (edge functions).
--  · Generado mecánicamente desde pg_policy + role_table_grants y verificado
--    por auditores adversariales. 100% reversible con GRANT.
-- ============================================================================

REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pagos_reportados FROM anon;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.accesos_externos FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.accesos_externos_log FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.administracion_emails FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.administraciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.agenda_categories FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.agenda_event_overrides FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.agenda_events FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.agenda_reminders_log FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.arca_anomalias FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.arca_config FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.arca_emision_queue FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.arca_emisores FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.arca_tokens FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.audit_log FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.auditoria_cambios FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.cajas FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.cajas_con_saldo FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.categorias_finanzas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.categorias_servicio FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.certificado_esquemas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.certificados FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.cj_documentos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.cliente_oportunidad_eventos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.comprobante_avisos_vencimiento FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.comprobantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.comunicaciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.comunicaciones_destinatarios FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.config_global FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.consorcios FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.constancias FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.csp_reports FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_bibliografia FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_clases FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_condiciones_config FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_encuentro_asistencias FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.curso_encuentro_zoom_eventos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_encuentros FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_encuesta_respuestas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_encuestas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_examen_secciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_examenes FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_matriculas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_modulo_material FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_modulos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_opciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_preguntas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.curso_progreso FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.cursos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.disertantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.dispatch_recupero_log FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.dispatch_vencimientos_log FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.email_plantillas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.email_queue FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.email_templates FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.email_throttle FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.encuentro_sesiones_compartidas FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.errores_runtime FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.examen_intentos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.formulario_adjuntos FROM authenticated;
REVOKE DELETE, REFERENCES, TRIGGER, TRUNCATE ON public.formulario_submissions FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.formulario_versiones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.formularios FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.frases_diarias FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.frases_dispatch_log FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.health_flow_alerts FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.health_flow_runs FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.historico_banco FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.historico_banco_lotes FROM authenticated;
REVOKE DELETE, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.import_log FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.items_comprobantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.lotes_facturacion FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.matricula_condiciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.movimiento_adjuntos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.movimiento_imputaciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.movimientos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.movimientos_lotes_historico FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.notificaciones_internas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.numeradores FROM authenticated;
REVOKE DELETE, REFERENCES, TRIGGER, TRUNCATE ON public.pagos_reportados FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.partner_atribuciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.partner_convenios FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.partner_rendiciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.partners FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.patrones_conciliacion FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.precio_audit FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE ON public.profiles FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.prospectos FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.push_notifications_queue FROM authenticated;
-- push_subscriptions: el UPDATE NO se revoca (auditor adversarial): el front
-- hace .upsert() y Postgres exige el privilegio UPDATE en parse-time aunque
-- no haya conflicto — revocarlo rompía "Activar notificaciones" para todos.
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.push_subscriptions FROM authenticated;

-- Hallazgo colateral del mismo auditor (bug LATENTE pre-existente): sin policy
-- UPDATE, un upsert con conflicto REAL (re-suscripción del mismo user_id +
-- endpoint con keys rotadas) ya fallaba hoy por RLS, en silencio. Policy del
-- dueño para que el upsert sea coherente de punta a punta.
DROP POLICY IF EXISTS push_sub_owner_update ON public.push_subscriptions;
CREATE POLICY push_sub_owner_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.recupero_acciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.recupero_config FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.recupero_plantillas FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.salud_alertas_log FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.sent_emails FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.servicio_vouchers FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.servicios FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.solicitud_derivaciones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.solicitudes FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tabulador_precios FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tracking_categorias_config FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tracking_estados_config FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tracking_lineas FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tramite_adjuntos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tramite_comentarios FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.tramite_eventos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tramite_pedidos_doc FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tramite_pedidos_doc_items FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.tramites FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tramix_cache FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tramix_detalle_cache FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tramix_documentos_cache FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.tramix_query_log FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tramix_session FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tramix_throttle FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.vencimientos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.vencimientos_config FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.vistas_guardadas FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.vw_accesos_externos_aperturas FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.vw_administracion_webinars FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.vw_agenda_unificada FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.vw_comprobantes_para_avisar FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.webinar_acceso_tokens FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.webinar_inscriptos FROM authenticated;
REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.webinar_zoom_eventos FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.webinars FROM authenticated;
