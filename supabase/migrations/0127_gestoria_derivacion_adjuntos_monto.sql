-- ============================================================================
-- Migration: 0127_gestoria_derivacion_adjuntos_monto
-- Fecha: 2026-05-28
-- N3 · Derivación a gestoría externa con adjuntos + monto interno.
-- El monto y los adjuntos son INTERNOS (cliente no los ve). El correo a la
-- gestoría queda registrado en sent_emails / email_queue.
-- ============================================================================

-- (a) Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('gestoria-adjuntos', 'gestoria-adjuntos', false)
ON CONFLICT (id) DO NOTHING;

-- (b) Columnas nuevas en la derivación
ALTER TABLE public.solicitud_derivaciones
  ADD COLUMN IF NOT EXISTS monto_pago_gestoria numeric(12,2),
  ADD COLUMN IF NOT EXISTS adjuntos_jsonb       jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.solicitud_derivaciones.monto_pago_gestoria IS
  'N3 · monto que la empresa paga a la gestoría. INTERNO. No visible al cliente.';
COMMENT ON COLUMN public.solicitud_derivaciones.adjuntos_jsonb IS
  'N3 · array de adjuntos del email a la gestoría: [{path, filename, mime, size}].';

-- (c) RPC solicitud_derivar_v2 con adjuntos + monto
-- (Aplicada vía Supabase MCP; ver definición en BD)
-- Firma: (p_solicitud_id uuid, p_destinatario_email text, p_destinatario_nombre text,
--         p_plantilla_slug text, p_observaciones text, p_dias_validez integer,
--         p_monto_pago numeric, p_adjuntos jsonb) RETURNS uuid

-- (d) RLS storage bucket gestoria-adjuntos: solo gerencia rw
CREATE POLICY gestoria_adjuntos_gerente_rw ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'gestoria-adjuntos'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente'))
  )
  WITH CHECK (
    bucket_id = 'gestoria-adjuntos'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente'))
  );
