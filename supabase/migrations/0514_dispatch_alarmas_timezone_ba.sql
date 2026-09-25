-- 0514 · Fix A1 (reporte JL 23/9/2026): las "Alarmas de hoy" no notificaban (ni email ni campanita).
--
-- CAUSA RAÍZ: desfase de timezone. El widget de gerencia `public.gerencia_alarmas_hoy()` corre con
-- SET "TimeZone"='America/Argentina/Buenos_Aires', pero el cron que NOTIFICA
-- (`private.dispatch_alarmas_tracking_hoy()`, pg_cron jobid 14, 09:00 BA) NO fija timezone → corre en
-- UTC. Una alarma con `alerta_en` en horario nocturno BA (≈00:xx UTC) se ve en el widget el día X (BA)
-- pero el cron la considera del día X+1 (UTC) y no la despacha. En ese hueco de 1 día calendario, si
-- gerencia resuelve o posterga la alarma, `alarma_dispatched_at` queda NULL y nunca se emite el aviso.
-- Caso testigo: TRM-2026-00165 y TRM-2026-00166 (23/9/2026).
--
-- FIX: alinear el dispatcher al widget agregando SET "TimeZone"='America/Argentina/Buenos_Aires'.
-- Así `CURRENT_DATE`, `alerta_en::date`, el guard `alarma_dispatched_at::date` y el flag `vencida` se
-- evalúan en BA, idénticos al widget. Cuerpo idéntico (sólo cambia el atributo de timezone).
-- Sin cambio de firma → sin overload (R16). Sólo notifica a gerentes/operadores (no toca al cliente).
-- Backlog al aplicar = 0 (verificado): no dispara ningún lote atrasado.

CREATE OR REPLACE FUNCTION private.dispatch_alarmas_tracking_hoy()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT tl.id, tl.descripcion, tl.alerta_en,
           t.id AS tramite_id, t.codigo, t.titulo,
           (tl.alerta_en < CURRENT_DATE) AS vencida
      FROM public.tracking_lineas tl
      JOIN public.tramites t ON t.id = tl.tramite_id
     WHERE tl.alerta_en IS NOT NULL
       AND tl.alerta_en::date <= CURRENT_DATE
       AND t.estado NOT IN ('resuelto','cerrado','cancelado')
       AND (tl.alarma_dispatched_at IS NULL
            OR tl.alarma_dispatched_at::date < CURRENT_DATE)
  LOOP
    BEGIN
      PERFORM public.notify_all_gerentes(
        'tracking_alarma',
        CASE WHEN r.vencida THEN '⚠ Alarma vencida: ' ELSE 'Alarma de hoy: ' END
          || COALESCE(NULLIF(r.titulo, ''), r.codigo),
        substring(COALESCE(r.descripcion, '') FROM 1 FOR 200),
        '/gerencia/trackings/' || r.tramite_id::text,
        jsonb_build_object(
          'linea_id', r.id,
          'tramite_id', r.tramite_id,
          'vencida', r.vencida,
          'alerta_en', r.alerta_en
        ),
        true, 'gerencia-notif-generica', NULL, 3::smallint,
        'tracking_lineas', r.id
      );
      UPDATE public.tracking_lineas
         SET alarma_dispatched_at = now()
       WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'dispatch_alarmas_tracking_hoy: falla linea_id=%: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$function$;