-- ============================================================================
-- 0246_movimiento_adjuntos.sql
-- DGG-85 (Fase A) · Adjuntos de comprobantes de gasto en EGRESOS (y cualquier
-- movimiento). Constancias: factura, transferencia, recibo, etc. Múltiples por
-- movimiento. Patrón clonado de tramite_adjuntos (0021): bucket privado +
-- signed URLs + safeStorageKey (R20).
--
-- Staff (gerencia) sube/gestiona. El PARTNER puede DESCARGAR los adjuntos de los
-- egresos donde participa (los necesita en su sábana / resumen de cuenta) — de ahí
-- la policy partner-select por `partner_id_atribucion`.
-- ============================================================================

-- Helper reusable: partner_id del usuario actual (rol 'partner'). SECURITY DEFINER
-- para no chocar con RLS de profiles dentro de las policies / la sábana.
CREATE OR REPLACE FUNCTION private.current_partner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  SELECT partner_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS public.movimiento_adjuntos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id uuid NOT NULL REFERENCES public.movimientos(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename_original text NOT NULL,
  mime_type text,
  size_bytes int,
  subido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimiento_adjuntos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movimiento_adjuntos TO authenticated; -- R6
CREATE INDEX IF NOT EXISTS idx_movadj_mov
  ON public.movimiento_adjuntos(movimiento_id, uploaded_at DESC);

-- Staff: control total.
DROP POLICY IF EXISTS mov_adj_staff_all ON public.movimiento_adjuntos;
CREATE POLICY mov_adj_staff_all ON public.movimiento_adjuntos
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Partner: SELECT de los adjuntos de egresos donde participa (read-only, sábana).
DROP POLICY IF EXISTS mov_adj_partner_select ON public.movimiento_adjuntos;
CREATE POLICY mov_adj_partner_select ON public.movimiento_adjuntos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.movimientos m
       WHERE m.id = movimiento_adjuntos.movimiento_id
         AND m.partner_id_atribucion IS NOT NULL
         AND m.partner_id_atribucion = private.current_partner_id()
    )
  );

-- Bucket privado.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'movimiento-adjuntos','movimiento-adjuntos', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mov_adj_obj_staff_all ON storage.objects;
CREATE POLICY mov_adj_obj_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'movimiento-adjuntos' AND private.is_staff())
  WITH CHECK (bucket_id = 'movimiento-adjuntos' AND private.is_staff());

DROP POLICY IF EXISTS mov_adj_obj_partner_select ON storage.objects;
CREATE POLICY mov_adj_obj_partner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'movimiento-adjuntos'
    AND EXISTS (
      SELECT 1 FROM public.movimiento_adjuntos a
        JOIN public.movimientos m ON m.id = a.movimiento_id
       WHERE a.storage_path = storage.objects.name
         AND m.partner_id_atribucion IS NOT NULL
         AND m.partner_id_atribucion = private.current_partner_id()
    )
  );
