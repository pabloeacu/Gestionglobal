-- ============================================================================
-- 0410 · DGG-129 (pedido JL 2026-08-06, gemelo de E-GG-153) — el egreso de la
-- derivación a gestoría acepta fecha de pago y N° de transferencia.
--
-- Hoy `solicitud_derivar_v3` registraba el egreso con fecha = CURRENT_DATE y
-- una referencia auto-generada (private.egreso_gestoria_ref) — igual que el
-- paso Cobranza antes de E-GG-153. El wizard ahora puede cargar:
--   · p_fecha_pago  → fecha real de la transferencia (NULL = hoy, como antes)
--   · p_referencia  → N° de transferencia/comprobante (NULL/'' = referencia
--     automática, como antes — cero regresión)
--
-- R16: la firma GANA parámetros → DROP de la firma vieja + CREATE (jamás
-- CREATE OR REPLACE solo, que dejaría un overload ambiguo para PostgREST).
-- ============================================================================

DROP FUNCTION IF EXISTS public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid
);

CREATE FUNCTION public.solicitud_derivar_v3(
  p_solicitud_id uuid,
  p_destinatario_email text,
  p_destinatario_nombre text,
  p_plantilla_slug text DEFAULT 'solicitud-derivada-gestoria'::text,
  p_observaciones text DEFAULT NULL::text,
  p_dias_validez integer DEFAULT 7,
  p_monto_pago numeric DEFAULT NULL::numeric,
  p_adjuntos jsonb DEFAULT '[]'::jsonb,
  p_caja_id uuid DEFAULT NULL::uuid,
  p_categoria_id uuid DEFAULT NULL::uuid,
  p_fecha_pago date DEFAULT NULL::date,
  p_referencia text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_derivacion_id  uuid;
  v_movimiento_id  uuid;
  v_categoria_id   uuid := p_categoria_id;
  v_admin_id       uuid;
  v_descripcion    text;
  v_referencia     text;
  v_ref_obj        jsonb;
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
       WHERE nombre = 'Servicios de Gestoría' AND tipo = 'egreso' AND activo
       LIMIT 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
      RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = 'P0002';
    END IF;

    SELECT s.cliente_id INTO v_admin_id
      FROM public.solicitudes s WHERE s.id = p_solicitud_id;

    v_ref_obj := private.egreso_gestoria_ref(
      p_solicitud_id,
      COALESCE(NULLIF(trim(p_destinatario_nombre), ''), p_destinatario_email)
    );
    v_descripcion := v_ref_obj->>'descripcion';
    -- DGG-129: el N° de transferencia cargado por la gerencia manda; sin él,
    -- la referencia automática de siempre (cero regresión).
    v_referencia  := COALESCE(NULLIF(trim(p_referencia), ''), v_ref_obj->>'referencia');

    INSERT INTO public.movimientos (
      caja_id, fecha, tipo, monto, descripcion, referencia,
      administracion_id, estado, origen, categoria_id, created_by
    ) VALUES (
      -- DGG-129: fecha real del pago si la gerencia la cargó; si no, hoy.
      p_caja_id, COALESCE(p_fecha_pago, CURRENT_DATE), 'egreso', p_monto_pago,
      v_descripcion, v_referencia, v_admin_id, 'identificado',
      'derivacion_gestoria', v_categoria_id, auth.uid()
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
$function$;

GRANT EXECUTE ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid, date, text
) TO authenticated;
