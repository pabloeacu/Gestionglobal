-- 0624_dgg221_reverify_curso_segments.sql
-- DGG-221 · Extender la re-verificación TRAMIX a los segmentos de CURSO.
-- --------------------------------------------------------------------------
-- La re-verificación de "vencidos" (prior session) reveló ~31% de dato stale
-- del enriquecimiento Fase-1 (12-13/10): gente que ya renovó (falsa-vencida)
-- o que empezó a renovar (en trámite). Los segmentos de curso
-- (curso_reno_30 ≤30d, curso_31_90 31-90d) se calcularon con EL MISMO dato
-- viejo y alimentan plantillas de vencimiento (captacion-curso-reno /
-- captacion-curso-3190). Mismo riesgo: un prospecto que ya renovó figura como
-- "se te vence en N días" cuando en realidad está vigente un año más.
--
-- Se re-encolan en `prospecto_tramix_queue` (estado='pendiente') los hijos
-- padrón 'ok' de los parents que HOY caen en esos dos segmentos. El goteo
-- 1/min (único consumidor, guardrail DGG-216) los re-scrapea tras drenar los
-- vencidos restantes; el watcher (mig 0621) mantiene el motor pausado +
-- sentinel hasta que la cola entera drene, así que esto extiende la pausa a
-- estos segmentos (comportamiento deseado: no reanudar envíos a un segmento
-- sin re-verificarlo). Los hijos en 'flag' (baja/not_found) NO se re-encolan:
-- ya son terminales y el parent toma su vencimiento del hijo 'ok' que sí entra.
-- Idempotente: re-aplicar sólo re-encola lo que hoy siga en esos segmentos.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_n int;
BEGIN
  WITH curso_parents AS (
    SELECT p.id
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
      AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND p.email NOT LIKE '%@padron.invalid'
      AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
      AND public.prospecto_segmento(p.matricula_vencimiento, v_hoy)
          IN ('curso_reno_30', 'curso_31_90')
  )
  UPDATE public.prospecto_tramix_queue q
  SET estado = 'pendiente', intentos = 0, updated_at = now()
  FROM public.prospecto_padron pp
  WHERE q.padron_id = pp.id
    AND pp.prospecto_id IN (SELECT id FROM curso_parents)
    AND q.estado = 'ok';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'DGG-221 reverify curso: % legajos re-encolados a pendiente', v_n;
END $$;
