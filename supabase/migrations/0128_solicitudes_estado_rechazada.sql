-- ============================================================================
-- Migration: 0128_solicitudes_estado_rechazada
-- Fecha: 2026-05-28
-- Fix: incluir 'rechazada' en CHECK constraint de solicitudes.estado.
-- Faltó en mig 0125 (sólo agregamos columnas/RPC pero no el CHECK).
-- E-GG-N2-01.
-- ============================================================================

ALTER TABLE public.solicitudes DROP CONSTRAINT IF EXISTS solicitudes_estado_check;
ALTER TABLE public.solicitudes ADD CONSTRAINT solicitudes_estado_check
  CHECK (estado = ANY (ARRAY['recibida','en_revision','derivada','activada','rechazada','descartada']::text[]));
