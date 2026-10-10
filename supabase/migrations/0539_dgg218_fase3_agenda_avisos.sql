-- 0539_dgg218_fase3_agenda_avisos.sql
-- DGG-218 · FASE 3 — "Mi agenda": transparencia de qué se le va a recordar al
-- cliente y CUÁNDO. Hace tangible la experiencia premium de agenda personalizada
-- de alertas y alarmas (mandato de Pablo).
--
-- RPC `cliente_agenda_avisos()`: para el cliente logueado, devuelve la lista
-- cronológica de los PRÓXIMOS avisos que va a recibir — una fila por cada
-- (vencimiento vigente notificable × offset de alarma) cuya fecha de aviso
-- (fecha_vencimiento - offset) todavía no pasó. Respeta el MISMO gate que el
-- sender real (gg_vencimientos_planificar_alertas): no lista avisos de
-- renovación si hay una renovación en curso (C#4), ni filas pausadas, ni con
-- notificar_cliente=false.
--
-- Reglas: R5/R12 (SECDEF + tenencia vía current_administracion_id), R6 (GRANT),
-- R19 (universo completo; el límite 12 es sólo de presentación).

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

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'fecha_aviso')::date,
                               (x->>'fecha_vencimiento')::date), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'tipo', v.tipo,
             'descripcion', v.descripcion,
             'fecha_vencimiento', v.fecha_vencimiento,
             'fecha_aviso', (v.fecha_vencimiento - o * INTERVAL '1 day')::date,
             'dias_antes', o
           ) AS x
    FROM public.vencimientos v
    CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
    WHERE v.administracion_id = v_admin
      AND v.estado = 'vigente'
      AND v.pausado_at IS NULL
      AND COALESCE(v.notificar_cliente, true) = true
      AND (v.fecha_vencimiento - o * INTERVAL '1 day')::date >= v_hoy
      -- C#4: no anunciar avisos de renovación si ya hay una renovación en curso
      AND NOT (
        v.tipo = 'renovacion_rpac'
        AND EXISTS (
          SELECT 1 FROM public.tramites t
          WHERE t.administracion_id = v_admin
            AND t.categoria = 'renovacion'
            AND t.estado IN ('abierto','en_progreso','esperando_cliente')
        )
      )
    ORDER BY (v.fecha_vencimiento - o * INTERVAL '1 day')::date ASC
    LIMIT 12
  ) sub;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.cliente_agenda_avisos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_agenda_avisos() TO authenticated;
