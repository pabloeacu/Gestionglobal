-- ============================================================================
-- 0391 · E-GG-161 · matricula_cumple_encuesta rebotaba al SISTEMA
--
-- Descubierto por el e2e de DGG-119 Chunk B: el guard de la 0227 exige
-- staff O dueño de la matrícula, pero los llamadores INTERNOS corren sin
-- JWT (auth.uid() NULL): el trigger de emisión al cumplirse una condición
-- (cuando lo dispara una migración/proceso interno) y — el caso grave — el
-- CRON backstop gg_campus_emitir_certificados_pendientes (pg_cron, cada
-- 5 min): TODA su corrida rebotaba acá con 42501 y el best-effort (0229) lo
-- tragaba en silencio. El cron de emisión automática estaba roto desde 0227
-- sin ningún síntoma (lección E-GG-42: best-effort sin telemetría esconde).
--
-- Fix: permitir el contexto sistema (auth.uid() IS NULL — inalcanzable
-- desde PostgREST, donde todo usuario tiene uid). Staff y dueño siguen
-- igual; un tercero autenticado sigue en 42501.
-- Misma firma → CREATE OR REPLACE sin overload (R16 ok).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.matricula_cumple_encuesta(p_matricula_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_es_dueno boolean;
BEGIN
  -- E-GG-161: auth.uid() NULL = contexto interno (cron/trigger/migración).
  IF auth.uid() IS NOT NULL AND NOT private.is_staff() THEN
    SELECT EXISTS (SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id AND m.profile_id = auth.uid())
      INTO v_es_dueno;
    IF NOT v_es_dueno THEN
      RAISE EXCEPTION 'no_access: matrícula no pertenece al usuario' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m
    JOIN public.curso_encuestas e ON e.curso_id = m.curso_id
    WHERE m.id = p_matricula_id
      AND e.activa
      AND (
        e.requerida_para_cert
        OR EXISTS (SELECT 1 FROM public.curso_condiciones_config cc
                   WHERE cc.curso_id = m.curso_id AND cc.tipo = 'encuesta' AND cc.activa)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.curso_encuesta_respuestas r
        WHERE r.matricula_id = m.id AND r.encuesta_id = e.id
      )
  );
END;
$function$;

-- Re-disparo del backstop: emite lo que quedó retenido por el bug (hoy: la
-- matrícula de Selalle, 3/3 cumplidas — emisión legítima).
SELECT public.gg_campus_emitir_certificados_pendientes();
