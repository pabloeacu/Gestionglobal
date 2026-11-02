-- AUDIT-005: 31 índices sobre FKs sin cobertura.
-- Regla 11: toda FK debe tener su índice (Postgres NO los crea automáticamente).
-- Sin estos índices, el plan EXPLAIN ANALYZE de joins por estas FKs hace
-- Seq Scan, lo que escala mal cuando crece la cardinalidad.

CREATE INDEX IF NOT EXISTS idx_accesos_externos_created_by ON public.accesos_externos(created_by);
CREATE INDEX IF NOT EXISTS idx_arca_anomalias_resuelto_by ON public.arca_anomalias(resuelto_by);
CREATE INDEX IF NOT EXISTS idx_certificado_esquemas_created_by ON public.certificado_esquemas(created_by);
CREATE INDEX IF NOT EXISTS idx_cj_documentos_created_by ON public.cj_documentos(created_by);
CREATE INDEX IF NOT EXISTS idx_comprobante_avisos_vto_sent_email_id ON public.comprobante_avisos_vencimiento(sent_email_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_enviado_por ON public.comunicaciones(enviado_por);
CREATE INDEX IF NOT EXISTS idx_curso_encuesta_respuestas_publicado_por ON public.curso_encuesta_respuestas(publicado_por);
CREATE INDEX IF NOT EXISTS idx_curso_encuestas_created_by ON public.curso_encuestas(created_by);
CREATE INDEX IF NOT EXISTS idx_formulario_submissions_procesado_por ON public.formulario_submissions(procesado_por);
CREATE INDEX IF NOT EXISTS idx_formulario_submissions_comprobante_id ON public.formulario_submissions(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_formulario_versiones_guardado_por ON public.formulario_versiones(guardado_por);
CREATE INDEX IF NOT EXISTS idx_formularios_servicio_id ON public.formularios(servicio_id);
CREATE INDEX IF NOT EXISTS idx_formularios_created_by ON public.formularios(created_by);
CREATE INDEX IF NOT EXISTS idx_historico_banco_lotes_importado_por ON public.historico_banco_lotes(importado_por);
CREATE INDEX IF NOT EXISTS idx_movimientos_lotes_historico_created_by ON public.movimientos_lotes_historico(created_by);
CREATE INDEX IF NOT EXISTS idx_patrones_conciliacion_creado_por ON public.patrones_conciliacion(creado_por);
CREATE INDEX IF NOT EXISTS idx_patrones_conciliacion_categoria_id ON public.patrones_conciliacion(categoria_id);
CREATE INDEX IF NOT EXISTS idx_patrones_conciliacion_administracion_id ON public.patrones_conciliacion(administracion_id);
CREATE INDEX IF NOT EXISTS idx_precio_audit_autor ON public.precio_audit(autor);
CREATE INDEX IF NOT EXISTS idx_profiles_partner_id ON public.profiles(partner_id);
CREATE INDEX IF NOT EXISTS idx_prospectos_creado_por ON public.prospectos(creado_por);
CREATE INDEX IF NOT EXISTS idx_servicio_vouchers_created_by ON public.servicio_vouchers(created_by);
CREATE INDEX IF NOT EXISTS idx_solicitudes_rechazada_por ON public.solicitudes(rechazada_por);
CREATE INDEX IF NOT EXISTS idx_tramite_pedidos_doc_creado_por ON public.tramite_pedidos_doc(creado_por);
CREATE INDEX IF NOT EXISTS idx_tramite_pedidos_doc_cerrado_por ON public.tramite_pedidos_doc(cerrado_por);
CREATE INDEX IF NOT EXISTS idx_tramite_pedidos_doc_items_revisado_por ON public.tramite_pedidos_doc_items(revisado_por);
CREATE INDEX IF NOT EXISTS idx_tramite_pedidos_doc_items_subido_por ON public.tramite_pedidos_doc_items(subido_por);
CREATE INDEX IF NOT EXISTS idx_vencimientos_pausado_por ON public.vencimientos(pausado_por);
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_profile_id ON public.webinar_inscriptos(profile_id);
CREATE INDEX IF NOT EXISTS idx_webinar_zoom_eventos_webinar_inscripto_id ON public.webinar_zoom_eventos(webinar_inscripto_id);
CREATE INDEX IF NOT EXISTS idx_webinars_creado_por ON public.webinars(creado_por);