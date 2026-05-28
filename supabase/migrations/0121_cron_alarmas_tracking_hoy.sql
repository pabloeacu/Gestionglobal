-- ============================================================================
-- Migration: 0121_cron_alarmas_tracking_hoy
-- Fecha: 2026-05-28
-- DGG-XX · Bloque A · Fase 2 (parte 2)
-- Dispatch diario de alarmas de tracking. A las 12:00 UTC (9:00 ART) cada
-- día, recorre las alarmas vencidas o de hoy y emite una notificación al
-- staff por cada una usando notif_emitir_staff (que ya distribuye in-app +
-- push si están configurados).
-- ============================================================================

ALTER TABLE public.tracking_lineas
  ADD COLUMN IF NOT EXISTS alarma_dispatched_at timestamptz;

CREATE OR REPLACE FUNCTION private.dispatch_alarmas_tracking_hoy()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
      PERFORM private.notif_emitir_staff(
        'tracking_alarma',
        CASE WHEN r.vencida THEN '⚠ Alarma vencida: ' ELSE 'Alarma de hoy: ' END
          || COALESCE(NULLIF(r.titulo, ''), r.codigo),
        substring(r.descripcion FROM 1 FOR 200),
        '/gerencia/trackings/' || r.tramite_id::text,
        jsonb_build_object(
          'linea_id', r.id,
          'tramite_id', r.tramite_id,
          'vencida', r.vencida,
          'alerta_en', r.alerta_en
        )
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
$$;

-- pg_cron diario a las 12:00 UTC (9:00 ART)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch_alarmas_tracking_hoy') THEN
    PERFORM cron.schedule(
      'dispatch_alarmas_tracking_hoy',
      '0 12 * * *',
      $cron$SELECT private.dispatch_alarmas_tracking_hoy();$cron$
    );
  END IF;
END $$;
