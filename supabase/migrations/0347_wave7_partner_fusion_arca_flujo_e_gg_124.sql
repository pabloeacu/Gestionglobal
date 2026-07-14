-- 0347 · WAVE 7 · E-GG-124: hallazgos ALTA/MEDIA de la auditoría (partner, fusión,
-- ARCA roto, flujo de caja). Todos CREATE OR REPLACE misma firma (R16 ok).

-- ── (1) partner_sabana: participación $0 tras cerrar/renovar el convenio ──────
-- El LATERAL resolvía el convenio con `pc.activo` → cuando un convenio se cierra
-- (activo=false) o se renueva, TODA la historia del partner quedaba con 0% (no
-- encontraba convenio vigente a la fecha de la operación pasada). Fix: resolver el
-- convenio SÓLO por rango de fechas (el que efectivamente regía a esa fecha),
-- desempatando por vigencia_desde DESC. Semántica histórica correcta.
CREATE OR REPLACE FUNCTION public.partner_sabana(p_partner_id uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, comprobante_id uuid, comprobante_label text, cliente_nombre text, comprobante_total numeric, comprobante_saldo numeric, operacion_monto numeric, chip text, porcentaje numeric, participacion_monto numeric, saldo_participacion numeric, movimiento_id uuid, adjuntos_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partner uuid;
  v_caller_partner uuid := private.current_partner_id();
BEGIN
  IF v_caller_partner IS NOT NULL THEN v_partner := v_caller_partner;
  ELSIF private.is_staff() THEN v_partner := p_partner_id;
  ELSE RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF v_partner IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH imp AS (
    SELECT
      m.fecha AS f, mi.created_at AS ord, mi.monto_imputado AS oper,
      c.id AS comp_id, c.tipo AS ctipo, c.punto_venta AS cpv, c.numero AS cnum,
      c.total AS ctotal, c.administracion_id AS adm_id, m.descripcion AS mdesc,
      m.id AS mov_id,
      c.total - SUM(mi.monto_imputado) OVER (
        PARTITION BY c.id ORDER BY m.fecha, mi.created_at, mi.id ROWS UNBOUNDED PRECEDING
      ) AS saldo_after,
      m.partner_id_atribucion AS pid
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
      AND m.tipo = 'ingreso' AND m.estado <> 'anulado'
    JOIN public.comprobantes c ON c.id = mi.comprobante_id AND c.estado <> 'anulado'
    WHERE c.id IN (
      SELECT mi2.comprobante_id FROM public.movimiento_imputaciones mi2
        JOIN public.movimientos m2 ON m2.id = mi2.movimiento_id
       WHERE m2.partner_id_atribucion = v_partner AND m2.tipo='ingreso' AND m2.estado<>'anulado'
    )
  ),
  ingresos AS (
    SELECT
      i.f AS fecha, 'ingreso'::text AS tipo,
      COALESCE(NULLIF(i.mdesc,''), 'Cobranza') AS descripcion,
      i.comp_id AS comprobante_id,
      (i.ctipo || ' ' || lpad(i.cpv::text,5,'0') || '-' || lpad(COALESCE(i.cnum,0)::text,8,'0')) AS comprobante_label,
      a.nombre AS cliente_nombre, i.ctotal AS comprobante_total,
      GREATEST(i.saldo_after, 0) AS comprobante_saldo, i.oper AS operacion_monto,
      CASE WHEN i.saldo_after <= 0.009 THEN 'total' ELSE 'parcial' END AS chip,
      i.oper AS base, 'ingreso'::text AS conv_tipo, i.f AS conv_fecha,
      i.mov_id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = i.mov_id) AS adjuntos_count
    FROM imp i
    LEFT JOIN public.administraciones a ON a.id = i.adm_id
    WHERE i.pid = v_partner
  ),
  egresos AS (
    SELECT
      m.fecha AS fecha, 'egreso'::text AS tipo,
      COALESCE(NULLIF(m.descripcion,''), 'Egreso') AS descripcion,
      NULL::uuid AS comprobante_id, NULL::text AS comprobante_label,
      a.nombre AS cliente_nombre, NULL::numeric AS comprobante_total, NULL::numeric AS comprobante_saldo,
      m.monto AS operacion_monto, 'total'::text AS chip,
      m.monto AS base, 'costo'::text AS conv_tipo, m.fecha AS conv_fecha, m.id AS movimiento_id,
      (SELECT count(*) FROM public.movimiento_adjuntos ma WHERE ma.movimiento_id = m.id) AS adjuntos_count
    FROM public.movimientos m
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE m.tipo = 'egreso' AND m.estado <> 'anulado' AND m.partner_id_atribucion = v_partner
  ),
  todos AS (SELECT * FROM ingresos UNION ALL SELECT * FROM egresos),
  conpart AS (
    SELECT t.*, conv.porc,
      ROUND(t.base * COALESCE(conv.porc,0) / 100.0, 2) AS part_abs,
      CASE WHEN t.conv_tipo = 'ingreso' THEN 1 ELSE -1 END AS signo
    FROM todos t
    LEFT JOIN LATERAL (
      SELECT CASE WHEN t.conv_tipo='ingreso' THEN pc.porc_ingresos ELSE pc.porc_costos END AS porc
        FROM public.partner_convenios pc
       WHERE pc.partner_id = v_partner
         AND pc.vigencia_desde <= t.conv_fecha
         AND (pc.vigencia_hasta IS NULL OR pc.vigencia_hasta >= t.conv_fecha)
       ORDER BY pc.vigencia_desde DESC LIMIT 1
    ) conv ON true
  ),
  corrido AS (
    SELECT cp.*,
      SUM(cp.part_abs * cp.signo) OVER (
        ORDER BY cp.fecha, cp.conv_tipo DESC, cp.comprobante_id NULLS LAST ROWS UNBOUNDED PRECEDING
      ) AS saldo_part
    FROM conpart cp
  )
  SELECT co.fecha, co.tipo, co.descripcion, co.comprobante_id, co.comprobante_label,
    co.cliente_nombre, co.comprobante_total, co.comprobante_saldo, co.operacion_monto,
    co.chip, COALESCE(co.porc,0)::numeric, co.part_abs, co.saldo_part, co.movimiento_id, co.adjuntos_count
  FROM corrido co
  WHERE (p_desde IS NULL OR co.fecha >= p_desde) AND (p_hasta IS NULL OR co.fecha <= p_hasta)
  ORDER BY co.fecha, co.conv_tipo DESC, co.comprobante_id NULLS LAST;
END;
$function$;

-- ── (2) fz_reporte_flujo_caja: un ingreso REVERTIDO seguía contando ──────────
-- Filtraba estado<>'anulado' y origen<>'reversion' (saca la contra-entrada) pero
-- NO revertido_at → el ingreso original revertido seguía sumando. Fix: excluir los
-- revertidos (revertido_at IS NULL) en ambas queries → un revertido neteo 0.
CREATE OR REPLACE FUNCTION public.fz_reporte_flujo_caja(p_anio integer DEFAULT NULL::integer, p_caja_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(mes_num integer, mes_label text, mes_inicio date, ingresos numeric, egresos numeric, neto numeric, saldo_acumulado numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anio int := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_saldo_inicial numeric := 0;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo personal autorizado puede ver reportes'; END IF;
  SELECT COALESCE(SUM(
    CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto
         WHEN m.tipo IN ('egreso','transferencia_out') THEN -m.monto ELSE 0 END
  ), 0) INTO v_saldo_inicial
  FROM public.movimientos m
  WHERE m.estado <> 'anulado' AND m.origen <> 'reversion' AND m.revertido_at IS NULL
    AND m.fecha < make_date(v_anio, 1, 1)
    AND (p_caja_id IS NULL OR m.caja_id = p_caja_id);
  RETURN QUERY
  WITH meses AS (
    SELECT generate_series(1, 12) AS mes_num,
           ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']::text[] AS labels
  ),
  agg AS (
    SELECT EXTRACT(MONTH FROM m.fecha)::int AS mes_num,
      SUM(CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN m.tipo IN ('egreso','transferencia_out') THEN m.monto ELSE 0 END) AS egresos
    FROM public.movimientos m
    WHERE m.estado <> 'anulado' AND m.origen <> 'reversion' AND m.revertido_at IS NULL
      AND EXTRACT(YEAR FROM m.fecha) = v_anio
      AND (p_caja_id IS NULL OR m.caja_id = p_caja_id)
    GROUP BY EXTRACT(MONTH FROM m.fecha)
  ),
  combinado AS (
    SELECT m.mes_num, m.labels[m.mes_num] AS mes_label,
      make_date(v_anio, m.mes_num, 1) AS mes_inicio,
      COALESCE(a.ingresos, 0)::numeric AS ingresos,
      COALESCE(a.egresos, 0)::numeric AS egresos,
      (COALESCE(a.ingresos, 0) - COALESCE(a.egresos, 0))::numeric AS neto
    FROM meses m LEFT JOIN agg a ON a.mes_num = m.mes_num
    ORDER BY m.mes_num
  )
  SELECT c.mes_num, c.mes_label, c.mes_inicio, c.ingresos, c.egresos, c.neto,
    (v_saldo_inicial + SUM(c.neto) OVER (ORDER BY c.mes_num))::numeric AS saldo_acumulado
  FROM combinado c ORDER BY c.mes_num;
END; $function$;

-- ── (3) ARCA: RPC rotas (referencian public.is_staff() inexistente) ──────────
CREATE OR REPLACE FUNCTION public.arca_emisor_default()
 RETURNS arca_emisores
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_emisor public.arca_emisores;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_emisor FROM public.arca_emisores
   WHERE es_default = true AND activo = true ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.arca_emisores (nombre, razon_social, ambiente, es_default, activo)
    VALUES ('Gestión Global', 'Gestión Global', 'homologacion', true, true) RETURNING * INTO v_emisor;
  END IF;
  RETURN v_emisor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.arca_emisor_set_default(p_emisor_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arca_emisores WHERE id = p_emisor_id AND activo = true) THEN
    RAISE EXCEPTION 'emisor no existe o no está activo';
  END IF;
  UPDATE public.arca_emisores SET es_default = false WHERE es_default = true;
  UPDATE public.arca_emisores SET es_default = true, updated_at = now() WHERE id = p_emisor_id;
END;
$function$;

-- ── (4) fusionar_administraciones: reasignar pagos_reportados + profiles +
--        patrones_conciliacion (quedaban en la admin origen → huérfanos). ──────
CREATE OR REPLACE FUNCTION public.fusionar_administraciones(p_origen uuid, p_destino uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_dest_nombre text; v_orig_nombre text; v_res jsonb := '{}'::jsonb; v_n int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede fusionar administraciones' USING ERRCODE='42501'; END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN RAISE EXCEPTION 'Origen y destino deben ser distintos y no nulos' USING ERRCODE='22023'; END IF;
  SELECT nombre INTO v_dest_nombre FROM public.administraciones WHERE id=p_destino;
  IF v_dest_nombre IS NULL THEN RAISE EXCEPTION 'Destino inexistente' USING ERRCODE='P0002'; END IF;
  SELECT nombre INTO v_orig_nombre FROM public.administraciones WHERE id=p_origen;
  IF v_orig_nombre IS NULL THEN RAISE EXCEPTION 'Origen inexistente' USING ERRCODE='P0002'; END IF;
  UPDATE public.comprobantes SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comprobantes',v_n);
  UPDATE public.movimientos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('movimientos',v_n);
  UPDATE public.movimiento_imputaciones SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('imputaciones',v_n);
  UPDATE public.pagos_reportados SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('pagos_reportados',v_n);
  UPDATE public.tramites SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('tramites',v_n);
  UPDATE public.solicitudes SET cliente_id=p_destino WHERE cliente_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('solicitudes',v_n);
  UPDATE public.certificados SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('certificados',v_n);
  UPDATE public.curso_matriculas SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('matriculas',v_n);
  UPDATE public.webinar_inscriptos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('inscriptos',v_n);
  UPDATE public.consorcios SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('consorcios',v_n);
  UPDATE public.formulario_submissions SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('submissions',v_n);
  UPDATE public.vencimientos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('vencimientos',v_n);
  UPDATE public.recupero_acciones SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('recupero_acciones',v_n);
  UPDATE public.cliente_oportunidad_eventos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('oportunidad_eventos',v_n);
  UPDATE public.comunicaciones_destinatarios SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comunicaciones',v_n);
  UPDATE public.sent_emails SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('sent_emails',v_n);
  UPDATE public.email_queue SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('email_queue',v_n);
  UPDATE public.administracion_emails SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('emails_extra',v_n);
  UPDATE public.patrones_conciliacion SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('patrones_conciliacion',v_n);
  -- El usuario del cliente fusionado pasa a la admin destino (si no, seguía
  -- logueando contra una admin en 'baja' con portal vacío).
  UPDATE public.profiles SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('profiles',v_n);
  UPDATE public.prospectos SET convertido_a_administracion_id=p_destino WHERE convertido_a_administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('prospectos',v_n);
  UPDATE public.administraciones SET activo=false, estado='baja',
    nombre=v_orig_nombre||' [fusionado → '||v_dest_nombre||']', updated_at=now() WHERE id=p_origen;
  RETURN jsonb_build_object('ok',true,'origen',p_origen,'destino',p_destino,'movido',v_res);
END; $function$;
