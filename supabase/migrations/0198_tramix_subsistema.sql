-- 0198_tramix_subsistema.sql
-- DGG-46 · Subsistema TRAMIX (consulta de expedientes DPPJ-PBA en el portal de clientes).
-- Capa de datos 100% AISLADA: ninguna tabla existente se toca. Todas las escrituras
-- las hace la Edge Function `tramix-consulta` con service_role. Los clientes NO
-- acceden directo a estas tablas (RLS habilitada; salvo su propio query_log, sin
-- policy de lectura). Privacidad por construcción: el legajo se deriva server-side
-- de administraciones.legajo_rpac — nunca se confía en un legajo provisto por el cliente.
-- R6: GRANTs explícitos. R2: RLS en toda tabla. R18: smoke e2e de los RPCs al cierre.

-- ───────────────────────── tramix_cache (QueryExped por legajo) ─────────────────────────
CREATE TABLE public.tramix_cache (
  legajo        text PRIMARY KEY,
  payload       jsonb NOT NULL,
  estado_hash   text,                 -- hash de "numero:estado" para detección de cambios (futuro)
  consultado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_cache ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_cache IS 'TRAMIX: cache de resultados por legajo. Sólo service_role (Edge fn). RLS sin policy = sin acceso de clientes (por diseño).';
GRANT ALL ON public.tramix_cache TO service_role;
-- (sin GRANT a authenticated: tabla interna del subsistema, sólo la lee/escribe la Edge fn con service_role)

-- ───────────────────────── tramix_detalle_cache (ExpedDetails) ──────────────────────────
CREATE TABLE public.tramix_detalle_cache (
  ref_key       text PRIMARY KEY,     -- 'o:t:n:a'
  payload       jsonb NOT NULL,
  consultado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_detalle_cache ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_detalle_cache IS 'TRAMIX: cache de detalle de expediente. Sólo service_role.';
GRANT ALL ON public.tramix_detalle_cache TO service_role;

-- ───────────────────────── tramix_session (cookie singleton + T&C) ──────────────────────
CREATE TABLE public.tramix_session (
  id                 text PRIMARY KEY DEFAULT 'singleton',
  cookie             text,
  aceptado_at        timestamptz,
  expira_estimada_at timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_session ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_session IS 'TRAMIX: sesión singleton (JSESSIONID + T&C aceptados) reutilizable entre consultas. Sólo service_role.';
GRANT ALL ON public.tramix_session TO service_role;
INSERT INTO public.tramix_session (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- ───────────────────────── tramix_throttle (anti-martilleo singleton) ───────────────────
CREATE TABLE public.tramix_throttle (
  id                     text PRIMARY KEY DEFAULT 'singleton',
  last_hit_at            timestamptz,
  fallos_recientes       int NOT NULL DEFAULT 0,
  circuito_abierto_hasta timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_throttle ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_throttle IS 'TRAMIX: estado global de throttle + circuit-breaker. Sólo service_role.';
GRANT ALL ON public.tramix_throttle TO service_role;
INSERT INTO public.tramix_throttle (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- ───────────────────────── tramix_query_log (auditoría + cooldown/cap) ──────────────────
CREATE TABLE public.tramix_query_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  administracion_id uuid,
  user_id          uuid,
  legajo           text,
  resultado        text,
  at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_query_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_query_log IS 'TRAMIX: log de consultas (auditoría + base de cooldown/cap por usuario). Cliente lee su propio historial; staff todo.';
GRANT ALL ON public.tramix_query_log TO service_role;
GRANT SELECT ON public.tramix_query_log TO authenticated;
CREATE INDEX idx_tramix_qlog_user_at  ON public.tramix_query_log (user_id, at DESC);
CREATE INDEX idx_tramix_qlog_admin_at ON public.tramix_query_log (administracion_id, at DESC);
CREATE POLICY tramix_qlog_self_or_staff ON public.tramix_query_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_staff());

-- ───────────────────────── tramix_documentos_cache (binarios → Storage) ─────────────────
CREATE TABLE public.tramix_documentos_cache (
  doc_key      text PRIMARY KEY,
  storage_path text NOT NULL,
  nombre       text,
  content_type text,
  bajado_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramix_documentos_cache ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tramix_documentos_cache IS 'TRAMIX: cache de documentos bajados a Storage privado. Sólo service_role.';
GRANT ALL ON public.tramix_documentos_cache TO service_role;

-- ───────────────────────── Storage bucket privado ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('tramix-documentos','tramix-documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ═════════════════════════ RPC: gate atómico anti-martilleo ════════════════════════════
CREATE OR REPLACE FUNCTION public.tramix_gate(p_user uuid, p_legajo text, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_min_interval_ms constant int := 3500;   -- ms mínimos entre hits globales a TRAMIX
  c_cooldown_s      constant int := 30;      -- por usuario+legajo (sólo refresco forzado)
  c_cap_hour        constant int := 30;      -- consultas por usuario por hora
  v_now timestamptz := clock_timestamp();
  v_th  public.tramix_throttle%ROWTYPE;
  v_last_force timestamptz;
  v_cap int;
  v_wait int;
BEGIN
  SELECT * INTO v_th FROM public.tramix_throttle WHERE id='singleton' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.tramix_throttle(id) VALUES('singleton') ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_th FROM public.tramix_throttle WHERE id='singleton' FOR UPDATE;
  END IF;

  -- circuit breaker abierto → no salir a TRAMIX
  IF v_th.circuito_abierto_hasta IS NOT NULL AND v_th.circuito_abierto_hasta > v_now THEN
    RETURN jsonb_build_object('decision','circuit_open','retry_at', v_th.circuito_abierto_hasta);
  END IF;

  -- tope por usuario/hora
  SELECT count(*) INTO v_cap FROM public.tramix_query_log
    WHERE user_id = p_user AND at > v_now - interval '1 hour';
  IF v_cap >= c_cap_hour THEN
    RETURN jsonb_build_object('decision','cap');
  END IF;

  -- cooldown por usuario+legajo (sólo cuando el usuario fuerza refresco)
  IF p_force THEN
    SELECT max(at) INTO v_last_force FROM public.tramix_query_log
      WHERE user_id = p_user AND legajo = p_legajo;
    IF v_last_force IS NOT NULL AND v_last_force > v_now - make_interval(secs => c_cooldown_s) THEN
      RETURN jsonb_build_object('decision','cooldown',
        'wait_ms', ceil(extract(epoch from (v_last_force + make_interval(secs => c_cooldown_s) - v_now)) * 1000)::int);
    END IF;
  END IF;

  -- throttle global (intervalo mínimo entre hits)
  IF v_th.last_hit_at IS NOT NULL THEN
    v_wait := c_min_interval_ms - floor(extract(epoch from (v_now - v_th.last_hit_at)) * 1000)::int;
    IF v_wait > 0 THEN
      RETURN jsonb_build_object('decision','throttled','wait_ms', v_wait);
    END IF;
  END IF;

  -- claim del slot
  UPDATE public.tramix_throttle SET last_hit_at = v_now, updated_at = v_now WHERE id='singleton';
  RETURN jsonb_build_object('decision','allow');
END $fn$;
REVOKE ALL ON FUNCTION public.tramix_gate(uuid,text,boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_gate(uuid,text,boolean) TO service_role;

-- ═════════════════════════ RPC: record (log + circuit-breaker) ═════════════════════════
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
  v_is_fail boolean := p_resultado IN ('TRAMIX_DOWN','TIMEOUT','ERROR','PARSE_ERROR','TC_BLOCKED');
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
    UPDATE public.tramix_throttle SET fallos_recientes = 0, updated_at = v_now WHERE id='singleton';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.tramix_record(uuid,uuid,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_record(uuid,uuid,text,text) TO service_role;

-- ═════════════════════════ SMOKE e2e (R18) · subtransacción que se revierte ═════════════
DO $smoke$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_dec jsonb;
  v_fallos int;
BEGIN
  BEGIN
    -- gate #1 (cold) → allow
    v_dec := public.tramix_gate(v_uid, '999999', false);
    IF v_dec->>'decision' <> 'allow' THEN RAISE EXCEPTION 'smoke gate#1 esperaba allow, dio %', v_dec; END IF;

    -- gate #2 inmediato → throttled (intervalo mínimo)
    v_dec := public.tramix_gate(v_uid, '999999', false);
    IF v_dec->>'decision' <> 'throttled' THEN RAISE EXCEPTION 'smoke gate#2 esperaba throttled, dio %', v_dec; END IF;

    -- record OK → resetea fallos
    PERFORM public.tramix_record(v_uid, NULL, '999999', 'OK');
    -- record fail → incrementa fallos
    PERFORM public.tramix_record(v_uid, NULL, '999999', 'TIMEOUT');
    SELECT fallos_recientes INTO v_fallos FROM public.tramix_throttle WHERE id='singleton';
    IF COALESCE(v_fallos,0) < 1 THEN RAISE EXCEPTION 'smoke record(fail) no incremento fallos (=%）', v_fallos; END IF;

    -- log persistido
    IF (SELECT count(*) FROM public.tramix_query_log WHERE user_id = v_uid) <> 2 THEN
      RAISE EXCEPTION 'smoke esperaba 2 filas de log';
    END IF;

    RAISE EXCEPTION 'SMOKE_ROLLBACK';  -- revierte SOLO las mutaciones del smoke
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SMOKE_ROLLBACK' THEN RAISE; END IF;  -- un fallo real aborta la migración
  END;
END $smoke$;
