-- ============================================================================
-- 0006b_fk_indexes · agrega índices a las FK que el linter detectó sin cubrir
-- (regla 11 / E48 · toda FK con su índice). Mayormente sobre created_by, más
-- algunos vínculos opcionales que faltaban (email_queue.comprobante/consorcio,
-- items.servicio, movimientos.categoria/revertido, sent_emails.consorcio).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cajas_created_by
  ON public.cajas(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_categorias_finanzas_created_by
  ON public.categorias_finanzas(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comprobantes_created_by
  ON public.comprobantes(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consorcios_created_by
  ON public.consorcios(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lotes_facturacion_created_by
  ON public.lotes_facturacion(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imp_created_by
  ON public.movimiento_imputaciones(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_created_by
  ON public.movimientos(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sent_emails_created_by
  ON public.sent_emails(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_servicios_created_by
  ON public.servicios(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tabulador_created_by
  ON public.tabulador_precios(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_queue_created_by
  ON public.email_queue(created_by) WHERE created_by IS NOT NULL;

-- Vínculos opcionales en email_queue (para joins en envío individual / curso)
CREATE INDEX IF NOT EXISTS idx_email_queue_comprobante
  ON public.email_queue(comprobante_id) WHERE comprobante_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_queue_consorcio
  ON public.email_queue(consorcio_id) WHERE consorcio_id IS NOT NULL;

-- Items vinculados a un servicio del catálogo (trazabilidad multi-consorcio)
CREATE INDEX IF NOT EXISTS idx_items_servicio
  ON public.items_comprobantes(servicio_id) WHERE servicio_id IS NOT NULL;

-- Movimientos: categoría (filtros financieros) y reversión
CREATE INDEX IF NOT EXISTS idx_mov_categoria
  ON public.movimientos(categoria_id) WHERE categoria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_revertido
  ON public.movimientos(movimiento_revertido_id) WHERE movimiento_revertido_id IS NOT NULL;

-- sent_emails: consorcio (vista por edificio)
CREATE INDEX IF NOT EXISTS idx_sent_emails_consorcio
  ON public.sent_emails(consorcio_id) WHERE consorcio_id IS NOT NULL;
