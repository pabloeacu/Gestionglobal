-- ============================================================================
-- 0411 · DGG-129 §6 (12 agentes + refutación) — 3 fixes de BD
--
-- (1) La mig 0410 re-creó solicitud_derivar_v3 y Postgres le devolvió EXECUTE
--     a PUBLIC y anon por default (el sweep DGG-125 lo había revocado sobre la
--     firma vieja) → REVOKE. Regla: todo DROP+CREATE de función re-aplica los
--     REVOKE del ACL sweep.
-- (2) Guard de rango en p_fecha_pago (un año mal tipeado creaba un egreso en
--     1926 o 3026 que descuadra el extracto): 2020-01-01 .. hoy+7.
-- (3) PRE-EXISTENTE cazado por el auditor contable: fz_reporte_balance_mensual
--     excluía el contraasiento (origen <> 'reversion') pero SEGUÍA CONTANDO el
--     movimiento original revertido (sin filtro revertido_at) → tras revertir
--     un egreso, el Balance mensual y el Flujo de caja divergían para siempre.
--     Se agrega `AND mov.revertido_at IS NULL` a las 3 subqueries (mismo
--     criterio que fz_reporte_flujo_caja). Misma firma → OR REPLACE seguro.
-- ============================================================================

-- (1) Grants: solo authenticated (el gate real es is_staff adentro) + service.
REVOKE ALL ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid, date, text
) FROM PUBLIC, anon;
COMMENT ON FUNCTION public.solicitud_derivar_v3(
  uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid, date, text
) IS 'Deriva una solicitud a gestoría externa y registra el egreso en caja (DGG-43/DGG-129: fecha real + N° de transferencia). Staff-only (is_staff).';

-- (2) Guard de rango de fecha (misma firma de 12 params → OR REPLACE).
CREATE OR REPLACE FUNCTION public.solicitud_derivar_v3(
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
  -- DGG-129 §6: un año mal tipeado no debe fabricar un egreso fuera de época.
  IF p_fecha_pago IS NOT NULL
     AND p_fecha_pago NOT BETWEEN DATE '2020-01-01' AND (CURRENT_DATE + 7) THEN
    RAISE EXCEPTION 'fecha_pago_fuera_de_rango' USING ERRCODE = '22007';
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
    v_referencia  := COALESCE(NULLIF(trim(p_referencia), ''), v_ref_obj->>'referencia');

    INSERT INTO public.movimientos (
      caja_id, fecha, tipo, monto, descripcion, referencia,
      administracion_id, estado, origen, categoria_id, created_by
    ) VALUES (
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

-- (3) Balance mensual: los movimientos REVERTIDOS dejan de contarse (igual
--     que su contraasiento). Misma firma → OR REPLACE.
CREATE OR REPLACE FUNCTION public.fz_reporte_balance_mensual(p_anio integer DEFAULT NULL::integer, p_solo_activas boolean DEFAULT true)
 RETURNS TABLE(caja_id uuid, caja_nombre text, caja_tipo text, caja_color text, mes_num integer, mes_label text, saldo_inicial numeric, ingresos numeric, egresos numeric, saldo_final numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_anio int := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo personal autorizado puede ver reportes'; END IF;
  RETURN QUERY
  WITH cajas_filtradas AS (
    SELECT c.id, c.nombre, c.tipo, c.color FROM public.cajas c
    WHERE (NOT p_solo_activas OR c.activo)
  ),
  meses AS (
    SELECT generate_series(1, 12) AS mes_num,
      ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']::text[] AS labels
  ),
  cajas_meses AS (
    SELECT cf.id AS caja_id, cf.nombre, cf.tipo, cf.color,
      m.mes_num, m.labels[m.mes_num] AS mes_label
    FROM cajas_filtradas cf CROSS JOIN meses m
  ),
  saldos AS (
    SELECT cm.caja_id, cm.nombre, cm.tipo, cm.color, cm.mes_num, cm.mes_label,
      (SELECT COALESCE(SUM(CASE WHEN mov.tipo IN ('ingreso','transferencia_in') THEN mov.monto
                                WHEN mov.tipo IN ('egreso','transferencia_out') THEN -mov.monto ELSE 0 END), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id AND mov.estado <> 'anulado' AND mov.origen <> 'reversion'
         AND mov.revertido_at IS NULL
         AND mov.fecha < make_date(v_anio, cm.mes_num, 1)) AS saldo_inicial,
      (SELECT COALESCE(SUM(CASE WHEN mov.tipo IN ('ingreso','transferencia_in') THEN mov.monto ELSE 0 END), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id AND mov.estado <> 'anulado' AND mov.origen <> 'reversion'
         AND mov.revertido_at IS NULL
         AND EXTRACT(YEAR FROM mov.fecha) = v_anio AND EXTRACT(MONTH FROM mov.fecha) = cm.mes_num) AS ingresos,
      (SELECT COALESCE(SUM(CASE WHEN mov.tipo IN ('egreso','transferencia_out') THEN mov.monto ELSE 0 END), 0)
       FROM public.movimientos mov
       WHERE mov.caja_id = cm.caja_id AND mov.estado <> 'anulado' AND mov.origen <> 'reversion'
         AND mov.revertido_at IS NULL
         AND EXTRACT(YEAR FROM mov.fecha) = v_anio AND EXTRACT(MONTH FROM mov.fecha) = cm.mes_num) AS egresos
    FROM cajas_meses cm
  )
  SELECT s.caja_id, s.nombre AS caja_nombre, s.tipo AS caja_tipo, s.color AS caja_color,
    s.mes_num, s.mes_label,
    s.saldo_inicial::numeric, s.ingresos::numeric, s.egresos::numeric,
    (s.saldo_inicial + s.ingresos - s.egresos)::numeric AS saldo_final
  FROM saldos s ORDER BY s.nombre, s.mes_num;
END; $function$;
