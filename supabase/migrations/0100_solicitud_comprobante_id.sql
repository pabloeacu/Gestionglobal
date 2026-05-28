-- ============================================================================
-- Migration: 0100_solicitud_comprobante_id
-- Fecha: 2026-05-28
-- DGG-XX · #148: vincular solicitud ↔ comprobante para que desde el detalle
-- de la solicitud podamos generar/cobrar. La bonificación por convenio se
-- maneja a nivel item (manual) usando el campo `bonificacion_porc` que ya
-- existe en emitir_comprobante_manual; no agregamos tabla nueva.
-- ============================================================================

ALTER TABLE public.solicitudes
  ADD COLUMN IF NOT EXISTS comprobante_id uuid
    REFERENCES public.comprobantes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_solicitudes_comprobante
  ON public.solicitudes(comprobante_id)
  WHERE comprobante_id IS NOT NULL;

COMMENT ON COLUMN public.solicitudes.comprobante_id IS
  '#148: comprobante emitido desde el flujo de activación. NULL si aún no se generó.';
