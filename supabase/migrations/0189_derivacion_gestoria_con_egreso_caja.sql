-- ============================================================================
-- 0189 · DGG-43 · Derivación a gestoría con asiento contable automático
--
-- Pablo (2026-06-04): "Cuando se adjuntan archivos [a la derivación a
-- gestoría], estos podrían ser pagos. La categoría será por defecto
-- 'Gastos de gestoría' (si no existe, creala). Que el asiento contable
-- sea sólido y, una vez registrado, opere como cualquier otro pago."
--
-- Cambios:
--   1. Seed categoría "Gastos de gestoría" (tipo='egreso') idempotente.
--   2. ALTER `solicitud_derivaciones` ADD caja_id, categoria_finanzas_id,
--      movimiento_id (nullables, FK).
--   3. CHECK constraint de `movimientos.origen` extendido con valor nuevo
--      'derivacion_gestoria'.
--   4. RPC `solicitud_derivar_v3` que llama a v2 y, si hay monto > 0 +
--      caja, INSERTea un movimiento egreso atómicamente y vincula
--      derivación ↔ movimiento.
--
-- NOTA (DGG-43 v2 · mig 0190): Pablo pidió reusar la categoría existente
-- "Servicios de Gestoría" en lugar de crear "Gastos de gestoría". La 0190
-- redirige el default del RPC y elimina la categoría creada acá. El seed de
-- esta mig queda como histórico — la 0190 lo deja sin efecto.
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

COMMENT ON COLUMN public.solicitud_derivaciones.caja_id IS
  'DGG-43 · Caja en la que impactó el egreso por el pago a la gestoría.';
COMMENT ON COLUMN public.solicitud_derivaciones.categoria_finanzas_id IS
  'DGG-43 · Categoría del movimiento egreso. Default "Gastos de gestoría".';
COMMENT ON COLUMN public.solicitud_derivaciones.movimiento_id IS
  'DGG-43 · FK al movimiento egreso creado automáticamente. NULL si no se imputó.';

CREATE INDEX IF NOT EXISTS idx_solicitud_derivaciones_movimiento
  ON public.solicitud_derivaciones(movimiento_id)
  WHERE movimiento_id IS NOT NULL;

-- Extender el CHECK de movimientos.origen con 'derivacion_gestoria'.
ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_origen_check CHECK (origen = ANY (ARRAY[
    'manual',
    'conciliacion_auto',
    'facturacion',
    'ajuste',
    'historico_banco',
    'transferencia',
    'reversion',
    'historico_masivo',
    'derivacion_gestoria'
  ]));

-- RPC v3
CREATE OR REPLACE FUNCTION public.solicitud_derivar_v3(
  p_solicitud_id        uuid,
  p_destinatario_email  text,
  p_destinatario_nombre text,
  p_plantilla_slug      text DEFAULT 'solicitud-derivada-gestoria',
  p_observaciones       text DEFAULT NULL,
  p_dias_validez        integer DEFAULT 7,
  p_monto_pago          numeric DEFAULT NULL,
  p_adjuntos            jsonb DEFAULT '[]'::jsonb,
  p_caja_id             uuid DEFAULT NULL,
  p_categoria_id        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_derivacion_id  uuid;
  v_movimiento_id  uuid;
  v_categoria_id   uuid := p_categoria_id;
  v_admin_id       uuid;
  v_descripcion    text;
  v_referencia     text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo_staff_puede_derivar' USING ERRCODE = '42501';
  END IF;
  IF p_destinatario_email IS NULL OR length(trim(p_destinatario_email)) = 0 THEN
    RAISE EXCEPTION 'destinatario_email_requerido' USING ERRCODE = '23502';
  END IF;

  SELECT public.solicitud_derivar_v2(
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones, p_dias_validez,
    p_monto_pago, p_adjuntos
  ) INTO v_derivacion_id;

  IF p_monto_pago IS NOT NULL AND p_monto_pago > 0 AND p_caja_id IS NOT NULL THEN
    IF v_categoria_id IS NULL THEN
      SELECT id INTO v_categoria_id FROM public.categorias_finanzas
       WHERE nombre = 'Gastos de gestoría' AND tipo = 'egreso' AND activo
       LIMIT 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
      RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = 'P0002';
    END IF;

    SELECT s.cliente_id INTO v_admin_id
      FROM public.solicitudes s WHERE s.id = p_solicitud_id;
    v_referencia := 'SOL:' || p_solicitud_id::text;
    v_descripcion := 'Pago a gestoría · '
      || COALESCE(NULLIF(trim(p_destinatario_nombre), ''), p_destinatario_email)
      || ' · solicitud ' || left(p_solicitud_id::text, 8);

    INSERT INTO public.movimientos (
      caja_id, fecha, tipo, monto, descripcion, referencia,
      administracion_id, estado, origen, categoria_id, created_by
    ) VALUES (
      p_caja_id, CURRENT_DATE, 'egreso', p_monto_pago, v_descripcion,
      v_referencia, v_admin_id, 'identificado', 'derivacion_gestoria',
      v_categoria_id, auth.uid()
    )
    RETURNING id INTO v_movimiento_id;

    UPDATE public.solicitud_derivaciones
       SET caja_id               = p_caja_id,
           categoria_finanzas_id = v_categoria_id,
           movimiento_id         = v_movimiento_id
     WHERE id = v_derivacion_id;
  END IF;

  RETURN jsonb_build_object(
    'derivacion_id', v_derivacion_id,
    'movimiento_id', v_movimiento_id,
    'tiene_egreso',  v_movimiento_id IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid
) TO authenticated;

COMMENT ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid
) IS
  'DGG-43 · Deriva solicitud a gestoría y opcionalmente crea movimiento egreso atómico en la caja seleccionada. Categoría default "Gastos de gestoría". Devuelve jsonb {derivacion_id, movimiento_id, tiene_egreso}.';
