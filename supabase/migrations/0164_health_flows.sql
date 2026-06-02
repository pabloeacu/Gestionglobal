-- 0164 · Health check periódico de flujos críticos
--                DGG-32 (manual de salud asíncrono — preventivo)
--
-- Contexto: E-GG-26/27/28 fueron 3 fallas silenciosas en cascada que
-- estuvieron en producción 3-30 días sin que nadie las viera. Cada una
-- rompía un flujo crítico (captación de cursos, dispatch de emails/push/
-- ARCA, escalado de campanita a push web). El "Salud del sistema"
-- existente cubre métricas de BD pero NO ejercita los flujos.
--
-- Pedido del usuario (2026-06-01):
--   "Construi health check periódico de flujos críticos que ejercite la
--   cadena entera cada 12 horas. La primera a las 0:00 y la segunda a
--   las 12:00 y reporte a la pantalla de Salud del sistema. Solo si hay
--   un error que requiera alerta, empujará un push y un banner de alarma
--   en el dashboard de la gerencia."
--
-- Modelo:
--   health_flow_runs   — 1 row por corrida del cron (cada 12h)
--   health_flow_alerts — alertas vigentes; se crean/resuelven desde la
--                        RPC `health_flow_record_run`
--
-- Reglas aplicadas:
--   - regla 2: RLS ON; SELECT abierto a staff, INSERT/UPDATE solo SECURITY
--     DEFINER
--   - regla 5: RPC plpgsql SECURITY DEFINER + search_path
--   - regla 6: GRANTs explícitos a `authenticated` (post mig 0130 default
--     cambia)

-- ============================================================================
-- Tabla 1: health_flow_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.health_flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  overall_status text NOT NULL CHECK (overall_status IN ('ok','warning','critical')),
  duration_ms integer NOT NULL DEFAULT 0,
  -- Detalle de cada check (clave → resultado). Estructura del jsonb:
  --   { "email_queue_atascada": {"status":"ok","detail":"...","metric":42},
  --     "push_queue_atascada": {"status":"warning","detail":"...","metric":5},
  --     "captacion_trigger": {"status":"critical","detail":"trigger ausente",...},
  --     ... }
  -- Status posibles por check: 'ok' | 'warning' | 'critical' | 'skipped'.
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Origen de la corrida: 'cron' (default) o 'manual' (cuando un gerente
  -- toca "Correr ahora" desde la pantalla Salud).
  origen text NOT NULL DEFAULT 'cron' CHECK (origen IN ('cron','manual'))
);
COMMENT ON TABLE public.health_flow_runs IS
  'Bitácora de corridas del health check de flujos críticos (DGG-32). 1 row cada 12h.';

CREATE INDEX IF NOT EXISTS idx_health_flow_runs_run_at_desc
  ON public.health_flow_runs (run_at DESC);

ALTER TABLE public.health_flow_runs ENABLE ROW LEVEL SECURITY;

-- Solo staff (gerentes) leen runs. INSERT solo via SECURITY DEFINER.
DROP POLICY IF EXISTS health_flow_runs_select_staff ON public.health_flow_runs;
CREATE POLICY health_flow_runs_select_staff ON public.health_flow_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
    )
  );

GRANT SELECT ON public.health_flow_runs TO authenticated;

-- ============================================================================
-- Tabla 2: health_flow_alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.health_flow_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  -- Cuándo empezó a fallar (primer run donde se detectó).
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Última vez que un run confirmó que sigue mal. Si pasan >24h sin
  -- confirmación, asumimos resuelta automáticamente (auto-resolución).
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Cuándo se resolvió (NULL = activa).
  resolved_at timestamptz,
  -- "auto" si se cerró sola por no fallar más, "manual" si gerente lo marcó.
  resolved_by text CHECK (resolved_by IN ('auto','manual') OR resolved_by IS NULL),
  -- Último mensaje de error que vio el check (para mostrar en banner).
  last_error text,
  -- Run en el que se detectó por primera vez.
  origen_run_id uuid REFERENCES public.health_flow_runs(id) ON DELETE SET NULL,
  -- Si ya despachamos el push a los gerentes (para no enviar 2 veces si
  -- el mismo check sigue fallando en corridas siguientes).
  push_dispatched_at timestamptz
);
COMMENT ON TABLE public.health_flow_alerts IS
  'Alertas vigentes / históricas del health check. resolved_at IS NULL = activa.';

-- Solo puede haber UNA alerta activa por (check_key) a la vez. Index
-- parcial sobre activas (resolved_at NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_flow_alerts_active_check
  ON public.health_flow_alerts (check_key)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_health_flow_alerts_active
  ON public.health_flow_alerts (severity, started_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.health_flow_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_flow_alerts_select_staff ON public.health_flow_alerts;
CREATE POLICY health_flow_alerts_select_staff ON public.health_flow_alerts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
    )
  );

GRANT SELECT ON public.health_flow_alerts TO authenticated;

-- ============================================================================
-- RPC 1: registrar una corrida (llamada desde edge fn `health-flows-check`)
-- ============================================================================
-- Toma un jsonb con los resultados de cada check (status por clave), inserta
-- un row en health_flow_runs y evalúa alertas:
--   - Si un check pasó a 'critical' o 'warning' y no había alerta activa:
--     crea alerta y dispara push a gerentes (lo deja encolado en
--     push_notifications_queue + insert en notificaciones_internas).
--   - Si un check vuelve a 'ok' y había alerta activa: la marca como
--     resolved_by='auto' / resolved_at=now().
--   - Si un check sigue fallando: update last_seen_at + last_error.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_flow_record_run(
  p_overall_status text,
  p_duration_ms integer,
  p_checks jsonb,
  p_origen text DEFAULT 'cron'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_check_key text;
  v_check jsonb;
  v_status text;
  v_detail text;
  v_alert_id uuid;
  v_alert_existing public.health_flow_alerts;
  v_gerente_id uuid;
  v_push_payload jsonb;
BEGIN
  -- Solo cron secret (vía edge fn) o staff manual desde UI pueden invocar.
  -- La fn está SECURITY DEFINER así que asumimos quien llega acá ya pasó por
  -- la edge fn. Para evitar abuso desde frontend, validamos:
  --  - si auth.uid() existe → tiene que ser staff
  --  - si no hay auth (cron via service_role) → permitido
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
    ) THEN
      RAISE EXCEPTION 'No tenés permisos para registrar corridas de health check'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Insert del run
  INSERT INTO public.health_flow_runs (overall_status, duration_ms, checks, origen)
  VALUES (
    COALESCE(p_overall_status, 'ok'),
    COALESCE(p_duration_ms, 0),
    COALESCE(p_checks, '{}'::jsonb),
    COALESCE(p_origen, 'cron')
  )
  RETURNING id INTO v_run_id;

  -- Recorrer los checks y evaluar alertas
  FOR v_check_key, v_check IN SELECT * FROM jsonb_each(COALESCE(p_checks, '{}'::jsonb))
  LOOP
    v_status := v_check->>'status';
    v_detail := v_check->>'detail';

    -- Buscar alerta activa para este check_key
    SELECT * INTO v_alert_existing
    FROM public.health_flow_alerts
    WHERE check_key = v_check_key AND resolved_at IS NULL
    LIMIT 1;

    IF v_status IN ('warning','critical') THEN
      -- Hay falla. ¿Hay alerta activa?
      IF v_alert_existing.id IS NULL THEN
        -- No había alerta. Crear una nueva.
        INSERT INTO public.health_flow_alerts (
          check_key, severity, last_error, origen_run_id, last_seen_at
        ) VALUES (
          v_check_key, v_status, v_detail, v_run_id, now()
        )
        RETURNING id INTO v_alert_id;

        -- Dispatchar push + notif interna a gerentes y superadmin
        v_push_payload := jsonb_build_object(
          'title', CASE
            WHEN v_status = 'critical' THEN 'Alerta crítica en flujos del sistema'
            ELSE 'Aviso en flujos del sistema'
          END,
          'body', COALESCE(v_detail, v_check_key) || ' — revisá Salud del sistema',
          'url', '/gerencia/configuracion/salud',
          'tag', 'health-flow-' || v_check_key
        );

        FOR v_gerente_id IN
          SELECT id FROM public.profiles WHERE role IN ('gerente','superadmin')
        LOOP
          -- Notif interna (campanita)
          BEGIN
            PERFORM private.notif_emitir(
              p_user_id := v_gerente_id,
              p_tipo := 'sistema',
              p_titulo := v_push_payload->>'title',
              p_cuerpo := v_push_payload->>'body',
              p_url := v_push_payload->>'url',
              p_payload := v_push_payload
            );
          EXCEPTION WHEN OTHERS THEN
            -- Si notif_emitir falla, no rompemos el record_run. La alerta
            -- queda creada igualmente (banner sí lo va a mostrar).
            NULL;
          END;
        END LOOP;

        UPDATE public.health_flow_alerts
        SET push_dispatched_at = now()
        WHERE id = v_alert_id;

      ELSE
        -- Ya hay alerta. Actualizar last_seen + last_error. Si severity
        -- subió (warning → critical), también lo actualizamos.
        UPDATE public.health_flow_alerts
        SET last_seen_at = now(),
            last_error = v_detail,
            severity = CASE
              WHEN v_status = 'critical' THEN 'critical'
              ELSE v_alert_existing.severity
            END
        WHERE id = v_alert_existing.id;
      END IF;
    ELSIF v_status = 'ok' AND v_alert_existing.id IS NOT NULL THEN
      -- Check volvió a OK. Cerrar alerta automáticamente.
      UPDATE public.health_flow_alerts
      SET resolved_at = now(), resolved_by = 'auto'
      WHERE id = v_alert_existing.id;
    END IF;
  END LOOP;

  RETURN v_run_id;
END $$;

REVOKE ALL ON FUNCTION public.health_flow_record_run(text, integer, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.health_flow_record_run(text, integer, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.health_flow_record_run(text, integer, jsonb, text) IS
  'Registra una corrida del health check de flujos. Crea/cierra alertas y dispatchea push.';

-- ============================================================================
-- RPC 2: runs recientes (UI Salud → tab Flujos críticos)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_flow_runs_recent(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  run_at timestamptz,
  overall_status text,
  duration_ms integer,
  checks jsonb,
  origen text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo staff
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
  ) THEN
    RAISE EXCEPTION 'No tenés permisos' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.run_at, r.overall_status, r.duration_ms, r.checks, r.origen
  FROM public.health_flow_runs r
  ORDER BY r.run_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
END $$;

REVOKE ALL ON FUNCTION public.health_flow_runs_recent(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.health_flow_runs_recent(integer) TO authenticated, service_role;

-- ============================================================================
-- RPC 3: alertas activas (UI banner gerencia)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_flow_alerts_active()
RETURNS TABLE (
  id uuid,
  check_key text,
  severity text,
  started_at timestamptz,
  last_seen_at timestamptz,
  last_error text,
  origen_run_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
  ) THEN
    RAISE EXCEPTION 'No tenés permisos' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.check_key, a.severity, a.started_at, a.last_seen_at,
         a.last_error, a.origen_run_id
  FROM public.health_flow_alerts a
  WHERE a.resolved_at IS NULL
  ORDER BY
    CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END,
    a.started_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.health_flow_alerts_active() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.health_flow_alerts_active() TO authenticated, service_role;

-- ============================================================================
-- RPC 4: resolver alerta manualmente
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_flow_alert_resolve(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
  ) THEN
    RAISE EXCEPTION 'No tenés permisos' USING ERRCODE = '42501';
  END IF;

  UPDATE public.health_flow_alerts
  SET resolved_at = now(), resolved_by = 'manual'
  WHERE id = p_id AND resolved_at IS NULL;

  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.health_flow_alert_resolve(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.health_flow_alert_resolve(uuid) TO authenticated;

-- ============================================================================
-- RPC 5: auto-resolución de alertas viejas (>24h sin confirmación)
-- ============================================================================
-- Si una alerta no se "confirmó" (last_seen_at no se actualizó) en 24h,
-- asumimos que el check pasó a OK y la alerta no se cerró por algún error.
-- La cerramos sola. Esto es un safety net — el caso normal es que la
-- alerta se cierre cuando un nuevo run reporta 'ok' para ese check.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.health_flow_alerts_garbage_collect()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH cerradas AS (
    UPDATE public.health_flow_alerts
    SET resolved_at = now(), resolved_by = 'auto'
    WHERE resolved_at IS NULL
      AND last_seen_at < now() - interval '24 hours'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM cerradas;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.health_flow_alerts_garbage_collect() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.health_flow_alerts_garbage_collect() TO service_role;
