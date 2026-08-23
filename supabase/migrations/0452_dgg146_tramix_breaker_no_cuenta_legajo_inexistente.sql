-- 0452_dgg146_tramix_breaker_no_cuenta_legajo_inexistente.sql
-- DGG-146 · hallazgo §6-B #12 (ROMPE, blast-radius global) — CRÍTICO.
--
-- El circuit-breaker de TRAMIX (`tramix_throttle`, fila singleton GLOBAL)
-- se abre 10 min para TODA la plataforma tras 5 fallos consecutivos. En
-- `tramix_record` (mig 0198) `PARSE_ERROR` estaba en la lista de "fallos
-- de infraestructura" — pero la edge devuelve `PARSE_ERROR` cuando un
-- legajo NO matchea/está mal tipeado (index.ts:198), no sólo cuando el
-- markup de TRAMIX cambió. Con el acceso libre desde el Inicio (DGG-146),
-- gerencia tipea legajos de potenciales clientes que probablemente no
-- existan: 5 tipeos errados seguidos abrían el breaker global 10 min,
-- dejando a los CLIENTES del portal sin consulta (CIRCUIT_OPEN).
--
-- Fix: `PARSE_ERROR` deja de contar hacia el breaker. Una caída real de
-- TRAMIX se manifiesta como TRAMIX_DOWN / TIMEOUT (error de red/timeout en
-- el try/catch de la edge, index.ts:174,206), un 500 como ERROR, y la
-- pared de T&C como TC_BLOCKED — esos SIGUEN abriendo el breaker. Un
-- cambio de markup produciría PARSE_ERROR en TODOS los legajos, pero el
-- breaker no es la herramienta para eso (abriría y reabriría cada 10 min
-- con la misma UX rota; requiere fix de código, no back-off).
--
-- Firma idéntica → CREATE OR REPLACE seguro (regla 16). Sólo cambia
-- v_is_fail; el resto de tramix_record queda byte-idéntico a 0198.

CREATE OR REPLACE FUNCTION public.tramix_record(p_user uuid, p_administracion uuid, p_legajo text, p_resultado text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_breaker_threshold constant int := 5;
  c_breaker_open_min  constant int := 10;
  v_now timestamptz := clock_timestamp();
  v_fallos int;
  -- DGG-146 §6 #12: PARSE_ERROR (legajo sin match / markup) YA NO es fallo
  -- de infraestructura — no puede abrir el breaker global.
  v_is_fail boolean := p_resultado IN ('TRAMIX_DOWN','TIMEOUT','ERROR','TC_BLOCKED');
BEGIN
  INSERT INTO public.tramix_query_log(administracion_id, user_id, legajo, resultado, at)
  VALUES (p_administracion, p_user, p_legajo, p_resultado, v_now);

  IF v_is_fail THEN
    UPDATE public.tramix_throttle
      SET fallos_recientes = fallos_recientes + 1, updated_at = v_now
      WHERE id='singleton'
      RETURNING fallos_recientes INTO v_fallos;
    IF COALESCE(v_fallos,0) >= c_breaker_threshold THEN
      UPDATE public.tramix_throttle
        SET circuito_abierto_hasta = v_now + make_interval(mins => c_breaker_open_min),
            fallos_recientes = 0, updated_at = v_now
        WHERE id='singleton';
    END IF;
  ELSE
    -- OK / NOT_FOUND / PARSE_ERROR resetean la racha (hubo respuesta de TRAMIX).
    UPDATE public.tramix_throttle SET fallos_recientes = 0, updated_at = v_now WHERE id='singleton';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.tramix_record(uuid,uuid,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_record(uuid,uuid,text,text) TO service_role;
