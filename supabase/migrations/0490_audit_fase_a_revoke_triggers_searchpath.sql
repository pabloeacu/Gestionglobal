-- 0490 · Auditoría 2026-09 · FASE A (seguridad de acceso) · Etapa 1: endurecimiento provablemente seguro.
--
-- Contexto (T1/A1 del informe): el default ACL de Supabase da EXECUTE a anon/authenticated sobre TODA
-- función public. Eso deja invocables por REST a funciones que NUNCA deberían llamarse directo.
--
-- (1) FUNCIONES DE TRIGGER (36): retornan `trigger`, sólo se ejecutan por el mecanismo de triggers (que las
--     corre con los privilegios del owner de la tabla, NO del rol que hace el statement). El grant de EXECUTE
--     a anon/authenticated es 100% inútil para su función real y sólo agranda la superficie. REVOKE de las 36
--     → CERO impacto (un trigger sigue disparando sin ese grant; llamarlas directo siempre dio error
--     "trigger functions can only be called as triggers"). Advisor: 17 exec por authenticated + 16 por anon.
--
-- (2) SEARCH_PATH MUTABLE (3): private.safe_int/safe_ts/curso_estado_publicacion no fijan search_path
--     (advisor function_search_path_mutable). Son helpers puros (no SECURITY DEFINER), pero se fija por higiene.
--
-- NO se tocan las RPC públicas legítimas (las llama el front): eso va en la Etapa 3 con verificación
-- caso-por-caso de callers. Esta etapa es aditiva/negativa-inocua y no puede romper ningún flujo.

-- (1) REVOKE de las 36 funciones de trigger (todas 0-arg)
REVOKE EXECUTE ON FUNCTION public._audit_log_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notif_cobranza_recibida_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notif_solicitud_nueva_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notif_tracking_cerrado_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.asignar_dni_ficticio() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_admin_desde_tramite_submission() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_pedidos_doc_al_cerrar_tramite() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crear_tramite_desde_submission_auto() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrementar_envios_formulario() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.formulario_versionado() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inscribir_webinar_desde_submission() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subm_vincular_admin_al_procesar() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_submission_a_administracion() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_tramite_email_on_admin_email_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_asistencia_recompute() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_encuentro_cond_recompute() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_encuesta_respuesta_sync() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_webinar_token_bienvenida() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tracking_linea_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_cerrar_exige_cobrado() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_matricula_recordar_numero() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_on_adjunto_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_on_comentario_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_on_update() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_admin_matricula_venc_sync_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_admin_ofrecimientos_switch_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_certificado_celebrar_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_certificado_marca_completada_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_condicion_cumplida_emitir() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_examen_aprobado_sync_condicion() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_imp_validar_sum_no_supera_monto() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_imp_validar_sum_no_supera_total() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_matricula_completada_avisa_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn() FROM anon, authenticated;

-- (2) search_path fijo en los 3 helpers privados
ALTER FUNCTION private.safe_int(p text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION private.safe_ts(p text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION private.curso_estado_publicacion(p_activo boolean, p_publicar_at timestamp with time zone, p_despublicar_at timestamp with time zone) SET search_path = 'public', 'pg_temp';
