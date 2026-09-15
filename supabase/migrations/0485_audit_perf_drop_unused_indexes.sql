-- 0485 · Auditoría 2026-09 · PERFORMANCE (parte 4): dropear índices SIN USO.
--
-- HALLAZGO (advisor performance, unused_index=62): índices con idx_scan=0. Ventana de stats =
-- 131 días (stats_reset 2026-05-07, sin reset posterior), con la plataforma en producción real
-- (100+ clientes) desde ~2026-07-17 → "0 scans" es señal fuerte de índice genuinamente muerto.
--
-- ALCANCE (quirúrgico): de los 62, se dropean SÓLO los 31 que son a la vez:
--   · NO únicos (no hay uq_/constraint de unicidad detrás),
--   · NO respaldan una constraint (PK/UNIQUE/exclusión),
--   · NO respaldan una FK (R11: toda FK necesita su índice → esos se CONSERVAN aunque figuren sin uso).
-- Por lo tanto dropearlos NO puede afectar correctitud ni integridad — sólo (eventual) performance de
-- lectura, y es 100% REVERSIBLE: el CREATE exacto de cada uno queda abajo para recrearlo en 1 línea.
-- R11 verificado: fks_sin_indice = 0 antes y después (ninguna FK queda sin índice).
--
-- Los 14 índices FULL (cuestan en CADA escritura, incl. el GIN trigram caro de administraciones) dan el
-- mayor ahorro; los 17 parciales selectivos cuestan poco pero son ruido muerto. Pablo aprobó dropear los 31.
-- Si algún flujo de bajo tráfico llegara a necesitar uno, el advisor/EXPLAIN (regla 11) lo detecta y se
-- recrea con la línea comentada correspondiente.
--
-- Verificado: acceso/queries idénticos (los drops no cambian resultados), advisor unused_index -31,
-- fks_sin_indice=0 antes/después, §6 adversarial.
--
-- === REVERSIBILIDAD — CREATE exacto de cada índice dropeado (para restaurar si hiciera falta): ===
-- CREATE INDEX idx_email_queue_sending ON public.email_queue USING btree (sending_started_at) WHERE (status = 'sending'::text);
-- CREATE INDEX idx_sent_emails_provider_msg ON public.sent_emails USING btree (provider_msg_id) WHERE (provider_msg_id IS NOT NULL);
-- CREATE INDEX idx_comprobantes_partner_facturado ON public.comprobantes USING btree (partner_facturado_at) WHERE (partner_facturado_at IS NOT NULL);
-- CREATE INDEX idx_administraciones_nombre_norm_trgm ON public.administraciones USING gin (nombre_normalizado extensions.gin_trgm_ops);  -- opclass calificado por esquema para restaurar bajo cualquier search_path (pg_trgm vive en 'extensions')
-- CREATE INDEX idx_admin_cuit ON public.administraciones USING btree (cuit) WHERE (cuit IS NOT NULL);
-- CREATE INDEX idx_solicitudes_bonificacion_100 ON public.solicitudes USING btree (bonificacion_100) WHERE bonificacion_100;
-- CREATE INDEX idx_subm_cuit ON public.formulario_submissions USING btree (cuit_detectado) WHERE (cuit_detectado IS NOT NULL);
-- CREATE INDEX idx_ofrecimientos_codigo_fecha ON public.ofrecimientos_log USING btree (codigo, enviado_at DESC);
-- CREATE INDEX idx_cursos_categoria ON public.cursos USING btree (categoria) WHERE (categoria IS NOT NULL);
-- CREATE INDEX idx_webinars_modalidad ON public.webinars USING btree (modalidad) WHERE (modalidad <> 'online'::text);
-- CREATE INDEX idx_venc_pausado ON public.vencimientos USING btree (pausado_at) WHERE (pausado_at IS NOT NULL);
-- CREATE INDEX idx_email_templates_activo ON public.email_templates USING btree (activo) WHERE (activo = true);
-- CREATE INDEX idx_servicios_activo ON public.servicios USING btree (activo, orden) WHERE activo;
-- CREATE INDEX idx_servicios_form_publico ON public.servicios USING btree (formulario_publico_slug) WHERE (habilitado_formulario_publico AND activo);
-- CREATE INDEX idx_partners_activo ON public.partners USING btree (activo);
-- CREATE INDEX idx_resp_publicado ON public.curso_encuesta_respuestas USING btree (publicado, created_at DESC);
-- CREATE INDEX idx_resp_publicar ON public.curso_encuesta_respuestas USING btree (permite_publicar) WHERE permite_publicar;
-- CREATE INDEX idx_cajas_orden_nombre ON public.cajas USING btree (activo DESC, orden, nombre);
-- CREATE INDEX idx_cajas_activo_orden ON public.cajas USING btree (activo, orden);
-- CREATE INDEX idx_sesiones_compartidas_webex_meeting_id ON public.encuentro_sesiones_compartidas USING btree (webex_meeting_id) WHERE (webex_meeting_id IS NOT NULL);
-- CREATE INDEX idx_errores_fp ON public.errores_runtime USING btree (fingerprint);
-- CREATE INDEX idx_dispatch_recupero_corrida ON public.dispatch_recupero_log USING btree (corrida_at DESC);
-- CREATE INDEX idx_patrones_usos ON public.patrones_conciliacion USING btree (usos_count DESC);
-- CREATE INDEX idx_tabulador_convenio ON public.tabulador_precios USING btree (convenio, servicio_id) WHERE (convenio IS NOT NULL);
-- CREATE INDEX idx_recupero_plantillas_activo ON public.recupero_plantillas USING btree (activo) WHERE (activo = true);
-- CREATE INDEX idx_arca_tokens_expires_at ON public.arca_tokens USING btree (expires_at DESC);
-- CREATE INDEX idx_arca_anomalias_pendientes ON public.arca_anomalias USING btree (created_at DESC) WHERE (resuelto_at IS NULL);
-- CREATE INDEX idx_import_log_created ON public.import_log USING btree (created_at DESC);
-- CREATE INDEX idx_lotes_estado ON public.lotes_facturacion USING btree (estado);
-- CREATE INDEX idx_lotes_periodo ON public.lotes_facturacion USING btree (periodo DESC);
-- CREATE INDEX idx_salud_alertas_kind_enviado ON public.salud_alertas_log USING btree (kind, enviado_at DESC);
-- ================================================================================================

DROP INDEX IF EXISTS public.idx_email_queue_sending;
DROP INDEX IF EXISTS public.idx_sent_emails_provider_msg;
DROP INDEX IF EXISTS public.idx_comprobantes_partner_facturado;
DROP INDEX IF EXISTS public.idx_administraciones_nombre_norm_trgm;
DROP INDEX IF EXISTS public.idx_admin_cuit;
DROP INDEX IF EXISTS public.idx_solicitudes_bonificacion_100;
DROP INDEX IF EXISTS public.idx_subm_cuit;
DROP INDEX IF EXISTS public.idx_ofrecimientos_codigo_fecha;
DROP INDEX IF EXISTS public.idx_cursos_categoria;
DROP INDEX IF EXISTS public.idx_webinars_modalidad;
DROP INDEX IF EXISTS public.idx_venc_pausado;
DROP INDEX IF EXISTS public.idx_email_templates_activo;
DROP INDEX IF EXISTS public.idx_servicios_activo;
DROP INDEX IF EXISTS public.idx_servicios_form_publico;
DROP INDEX IF EXISTS public.idx_partners_activo;
DROP INDEX IF EXISTS public.idx_resp_publicado;
DROP INDEX IF EXISTS public.idx_resp_publicar;
DROP INDEX IF EXISTS public.idx_cajas_orden_nombre;
DROP INDEX IF EXISTS public.idx_cajas_activo_orden;
DROP INDEX IF EXISTS public.idx_sesiones_compartidas_webex_meeting_id;
DROP INDEX IF EXISTS public.idx_errores_fp;
DROP INDEX IF EXISTS public.idx_dispatch_recupero_corrida;
DROP INDEX IF EXISTS public.idx_patrones_usos;
DROP INDEX IF EXISTS public.idx_tabulador_convenio;
DROP INDEX IF EXISTS public.idx_recupero_plantillas_activo;
DROP INDEX IF EXISTS public.idx_arca_tokens_expires_at;
DROP INDEX IF EXISTS public.idx_arca_anomalias_pendientes;
DROP INDEX IF EXISTS public.idx_import_log_created;
DROP INDEX IF EXISTS public.idx_lotes_estado;
DROP INDEX IF EXISTS public.idx_lotes_periodo;
DROP INDEX IF EXISTS public.idx_salud_alertas_kind_enviado;
