-- 0540_dgg218_fase3_agenda_avisos_tiebreaker.sql
-- DGG-218 F3 · §6 #3: el LIMIT 12 ordenaba sólo por fecha_aviso → en empates de
-- fecha el recorte era no-determinista. Se agrega tiebreaker (fecha_vencimiento,
-- tipo) al ORDER BY interno, espejo de las claves del jsonb_agg externo.
CREATE OR REPLACE FUNCTION public.cliente_agenda_avisos()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp' SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
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
      AND v.estado = 'vigente' AND v.pausado_at IS NULL
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
