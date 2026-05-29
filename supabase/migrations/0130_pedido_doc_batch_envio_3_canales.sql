-- ============================================================================
-- Migration: 0130_pedido_doc_batch_envio_3_canales
-- Fecha: 2026-05-28
-- M2/M4 · Cambio importante de UX en pedidos de documentación:
-- (a) Subir un item ya NO notifica inmediatamente a gerencia.
-- (b) Cliente decide cuándo "Enviar a gerencia" (batch envío).
-- (c) Cada acción importante dispara los 3 canales: push + bell + email.
--
-- Aplicación completa vía Supabase MCP. Este archivo documenta el esquema.
-- ============================================================================

-- (a) columna que marca el momento del envío
ALTER TABLE public.tramite_pedidos_doc
  ADD COLUMN IF NOT EXISTS enviado_para_revision_at timestamptz;

-- (b) tramite_pedido_doc_subir_item: ya NO notifica gerencia (RPC actualizado)
-- (c) NUEVO RPC: tramite_pedido_doc_enviar_revision(p_pedido_id)
--     - Marca enviado_para_revision_at = now()
--     - Notifica a TODOS los gerentes activos: bell + push + email
--     - Email confirmación al cliente (recibido + 'pronto novedades')
--     - Inserta tracking_linea visible cliente
-- (d) tramite_pedido_doc_aprobar_item: ahora encola email cliente al cerrar
-- (e) tramite_pedido_doc_rechazar_item: ahora encola email cliente +
--     limpia enviado_para_revision_at para que el cliente vuelva a subir+enviar

-- Nuevos templates email (manaxer-v1 con campos visuales completos):
-- - tramite-docs-enviadas-gerencia
-- - tramite-docs-recibidas-cliente
-- - tramite-docs-aprobadas-cliente
-- - tramite-doc-rechazada-cliente
