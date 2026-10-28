-- 0604_dgg233_catchup_idempotencia_s6.sql
-- DGG-233 · E-GG-235 — cierre de hueco de idempotencia del catch-up (hallazgo §6).
-- --------------------------------------------------------------------------
-- El catch-up de 0602 usa offset sintético = (fecha - hoy), que CAMBIA cada día.
-- La clave única del edge en dispatch_vencimientos_log es (vencimiento_id,
-- offset_dias, canal), así que con un offset que cambia a diario esa dedup NO
-- protege entre días. La guarda del planner (NOT EXISTS email_cliente 'ok') corta
-- el loop SÓLO cuando el email sale 'ok'. Pero si el cliente NO tiene email, el
-- edge loguea email_cliente='skipped' (no 'ok') → la guarda no corta → el catch-up
-- re-emite todos los días dentro de la ventana (~hasta 60d) y el edge re-despacha
-- push_cliente (campanita) cada día. Spam latente para declarados sin email.
--   (Hoy no se manifiesta: los 11 catch-ups vivos tienen email → loguean 'ok'.)
--
-- FIX (opción §6/A): la guarda corta con `resultado IN ('ok','skipped')`. Así:
--   · email 'ok'       → notificado → no repite (camino feliz, ya funcionaba).
--   · email 'skipped'  → no hay a quién emailear → el push ya salió 1 vez el día
--                        1; no re-emitir (corta el loop).
--   · email 'error'    → fallo transitorio de encolado → sí reintenta (deseado).
-- Un aviso normal previo (cualquier offset con email 'ok') también corta el
-- catch-up (la guarda es por-vencimiento, no por-offset). El resto del planner
-- queda idéntico a 0602.
-- --------------------------------------------------------------------------

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

  -- DGG-233 catch-up (E-GG-235: guarda IN ('ok','skipped') para que un declarado
  -- sin email no re-emita push a diario).
  SELECT v.id, (v.fecha_vencimiento - p_fecha)::int AS offset_dias, v.fecha_vencimiento,
    v.administracion_id, v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  WHERE v.origen = 'declarado'
    AND v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND COALESCE(v.notificar_cliente, true)
    AND v.alarmas_offsets IS NOT NULL
    AND array_length(v.alarmas_offsets, 1) > 0
    AND p_fecha >= v.fecha_vencimiento - (SELECT max(o) FROM unnest(v.alarmas_offsets) AS o)
    AND p_fecha <= v.fecha_vencimiento - (SELECT min(o) FROM unnest(v.alarmas_offsets) AS o)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(v.alarmas_offsets) AS o
      WHERE v.fecha_vencimiento - o = p_fecha)
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_vencimientos_log dl
      WHERE dl.vencimiento_id = v.id AND dl.canal = 'email_cliente'
        AND dl.resultado IN ('ok','skipped'));
END;
$function$;
