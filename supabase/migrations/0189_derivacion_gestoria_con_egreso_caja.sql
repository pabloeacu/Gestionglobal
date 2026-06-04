-- ============================================================================
-- 0189 · DGG-43 · Derivación a gestoría con asiento contable automático
--
-- Pablo (2026-06-04): "Cuando se adjuntan archivos [a la derivación a
-- gestoría], estos podrían ser pagos. La categoría será por defecto
-- 'Gastos de gestoría' (si no existe, creala). Que el asiento contable
-- sea sólido y, una vez registrado, opere como cualquier otro pago."
-- ============================================================================

INSERT INTO public.categorias_finanzas (nombre, tipo, icono, activo)
SELECT 'Gastos de gestoría', 'egreso', 'Briefcase', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.categorias_finanzas
   WHERE nombre = 'Gastos de gestoría' AND tipo = 'egreso'
);

ALTER TABLE public.solicitud_derivaciones
  ADD COLUMN IF NOT EXISTS caja_id uuid REFERENCES public.cajas(id),
  ADD COLUMN IF NOT EXISTS categoria_finanzas_id uuid REFERENCES public.categorias_finanzas(id),
  ADD COLUMN IF NOT EXISTS movimiento_id uuid REFERENCES public.movimientos(id);

CREATE INDEX IF NOT EXISTS idx_solicitud_derivaciones_movimiento
  ON public.solicitud_derivaciones(movimiento_id)
  WHERE movimiento_id IS NOT NULL;

-- RPC solicitud_derivar_v3: extiende v2 con caja_id + categoria_id.
-- Si hay monto > 0 Y caja, crea movimiento egreso atómico en la misma
-- transacción y vincula derivación ↔ movimiento.
-- Ver definición completa aplicada en producción vía mig MCP.
COMMENT ON COLUMN public.solicitud_derivaciones.movimiento_id IS
  'DGG-43 · FK al movimiento egreso creado automáticamente. NULL si no se imputó.';
