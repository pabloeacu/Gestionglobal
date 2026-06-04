-- ============================================================================
-- 0190 · DGG-43 v2 · Reusar categoría "Servicios de Gestoría" existente
--
-- Pablo (2026-06-04): "Servicios de gestoría es una buena categoría. No hace
-- falta crear una nueva. Si ya lo hiciste, eliminala y redirigí el gasto bajo
-- la categoría existente."
--
-- Cambios:
--   1. RPC solicitud_derivar_v3: el lookup default ahora apunta a
--      'Servicios de Gestoría' (existente) en lugar de 'Gastos de gestoría'
--      (creada en 0189 y eliminada acá).
--   2. Eliminar la categoría 'Gastos de gestoría' (verificado: 0 movimientos,
--      0 derivaciones vinculadas → borrado seguro).
-- ============================================================================

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
    -- DGG-43 v2 · default a la categoría EXISTENTE "Servicios de Gestoría".
    IF v_categoria_id IS NULL THEN
      SELECT id INTO v_categoria_id FROM public.categorias_finanzas
       WHERE nombre = 'Servicios de Gestoría' AND tipo = 'egreso' AND activo
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

-- Eliminar la categoría "Gastos de gestoría" (solo si no tiene referencias).
DELETE FROM public.categorias_finanzas cf
WHERE cf.nombre = 'Gastos de gestoría'
  AND cf.tipo = 'egreso'
  AND NOT EXISTS (SELECT 1 FROM public.movimientos m WHERE m.categoria_id = cf.id)
  AND NOT EXISTS (SELECT 1 FROM public.solicitud_derivaciones sd WHERE sd.categoria_finanzas_id = cf.id);
