-- 0602_dgg233_declarado_catchup_y_agenda_vencido.sql
-- DGG-233 · Dos huecos del aviso de vencimientos DECLARADOS (caso GG Cursos / Pablo).
-- --------------------------------------------------------------------------
-- Síntoma: GG Cursos declaró su renovación de matrícula el 23-oct-26 (hoy 28-oct,
-- VENCIDA hace 5 días) y NO recibió correo, ni push, ni la vio en "Tu agenda de
-- avisos". Dos causas independientes, ambas de lógica (no de datos):
--
--   HUECO A — sin catch-up para un declarado que nace ya vencido.
--     El planner `gg_vencimientos_planificar_alertas` es match-por-fecha-EXACTA:
--     dispara el aviso cuyo (fecha_venc - offset) == hoy. Los vencimientos
--     declarados se materializaron el 28-oct (DGG-231 activó el 27); para la
--     renovación (23-oct, offsets {45,30,15,0,-7,-21}) todos los offsets ≤0
--     (incl. el día 0 = 23-oct) ya habían pasado al materializarse. Hoy (28)
--     no matchea ningún offset; el próximo es -7 (30-oct). Resultado: silencio
--     hasta el 30, y para el certificado (23-ene-26) silencio PARA SIEMPRE
--     (todos sus offsets quedaron en el pasado). El principio DGG-231 ("si el
--     cliente carga sus fechas, le avisamos") se rompe justo para el caso más
--     importante: una obligación que YA está vencida.
--     → FIX: el planner emite UN aviso catch-up para un declarado que esté
--       dentro de su ventana de alerta [fecha-max_offset, fecha-min_offset],
--       que hoy NO caiga en un offset exacto, y que NUNCA haya sido notificado
--       con éxito (email_cliente 'ok'). offset sintético = (fecha - hoy) → la
--       voz del edge sale correcta ("figura vencida" si es negativo). Idempotente
--       por la guarda "nunca notificado": una vez que sale el 'ok', no se repite;
--       los offsets reales (-7/-21) siguen su curso normal. Fuera de ventana
--       (ej. certificado 9 meses vencido) NO hay catch-up (no spameamos lo viejo).
--
--   HUECO B — la agenda del portal oculta lo vencido.
--     `cliente_agenda_avisos` filtra `estado='vigente'`, así que una renovación
--     ya vencida (estado='vencido') desaparece de "Tu agenda de avisos" aunque
--     el dispatch SÍ le mandará el -7/-21 (el planner incluye 'vencido'). El
--     cliente ve una agenda que no refleja lo que realmente le vamos a avisar.
--     → FIX: incluir 'vencido' (igual que el planner) para que muestre los
--       avisos próximos de una obligación recién vencida. Las vencidas antiguas
--       no aparecen igual (sus fecha_aviso ya pasaron, el filtro `>= hoy` las deja afuera).
-- --------------------------------------------------------------------------

-- HUECO A · catch-up en el planner (añade un UNION ALL; el resto queda idéntico).
CREATE OR REPLACE FUNCTION public.gg_vencimientos_planificar_alertas(p_fecha date DEFAULT hoy_ar())
 RETURNS TABLE(vencimiento_id uuid, offset_dias integer, fecha_vencimiento date, administracion_id uuid, consorcio_id uuid, notificar_cliente boolean, tipo text, descripcion text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT v.administracion_id AS admin_id
    FROM public.vencimientos v
    CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
    WHERE v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND v.estado IN ('vigente','vencido') AND v.pausado_at IS NULL
      AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
      AND NOT EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id)
  LOOP
    PERFORM private.gg_venc_encolar_refresh(r.admin_id);
  END LOOP;

  RETURN QUERY
  -- (1) Camino normal: offset exacto que matchea hoy.
  SELECT v.id, o::int AS offset_dias, v.fecha_vencimiento, v.administracion_id,
    v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.administracion_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente')))
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id))

  UNION ALL

  -- (2) DGG-233 · Catch-up: declarado en ventana, hoy NO es offset exacto, nunca
  -- notificado. Un solo aviso pronto para una obligación que entró al sistema ya
  -- dentro de su ventana (o vencida). offset = fecha - hoy (negativo = ya vencida).
  SELECT v.id, (v.fecha_vencimiento - p_fecha)::int AS offset_dias, v.fecha_vencimiento,
    v.administracion_id, v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  WHERE v.origen = 'declarado'
    AND v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND COALESCE(v.notificar_cliente, true)
    AND v.alarmas_offsets IS NOT NULL
    AND array_length(v.alarmas_offsets, 1) > 0
    -- dentro de la ventana de alerta [fecha - max_offset, fecha - min_offset]
    AND p_fecha >= v.fecha_vencimiento - (SELECT max(o) FROM unnest(v.alarmas_offsets) AS o)
    AND p_fecha <= v.fecha_vencimiento - (SELECT min(o) FROM unnest(v.alarmas_offsets) AS o)
    -- hoy NO cae en un offset exacto (ese lo cubre el camino (1))
    AND NOT EXISTS (
      SELECT 1 FROM unnest(v.alarmas_offsets) AS o
      WHERE v.fecha_vencimiento - o = p_fecha)
    -- nunca notificado con éxito al cliente → evita doble y repetición diaria
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_vencimientos_log dl
      WHERE dl.vencimiento_id = v.id AND dl.canal = 'email_cliente' AND dl.resultado = 'ok');
END;
$function$;

-- HUECO B · la agenda del portal incluye 'vencido' (espeja al planner).
CREATE OR REPLACE FUNCTION public.cliente_agenda_avisos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_admin uuid;
  v_hoy   date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_out   jsonb;
BEGIN
  v_admin := private.current_administracion_id();
  IF v_admin IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'fecha_aviso')::date, (x->>'fecha_vencimiento')::date), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'tipo', v.tipo, 'descripcion', v.descripcion,
             'fecha_vencimiento', v.fecha_vencimiento,
             'fecha_aviso', (v.fecha_vencimiento - o * INTERVAL '1 day')::date,
             'dias_antes', o
           ) AS x
    FROM public.vencimientos v
    CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
    WHERE v.administracion_id = v_admin
      AND v.estado IN ('vigente','vencido')   -- DGG-233: antes sólo 'vigente' → ocultaba lo recién vencido
      AND v.pausado_at IS NULL
      AND COALESCE(v.notificar_cliente, true) = true
      AND (v.fecha_vencimiento - o * INTERVAL '1 day')::date >= v_hoy
      AND NOT (
        v.tipo = 'renovacion_rpac'
        AND EXISTS (SELECT 1 FROM public.tramites t WHERE t.administracion_id = v_admin
                     AND t.categoria = 'renovacion' AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
      )
    ORDER BY (v.fecha_vencimiento - o * INTERVAL '1 day')::date ASC, v.fecha_vencimiento ASC, v.tipo ASC
    LIMIT 12
  ) sub;
  RETURN v_out;
END;
$function$;
