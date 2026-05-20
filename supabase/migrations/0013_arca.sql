-- ============================================================================
-- 0013_arca · Configuración ARCA + tokens WSAA + cola de emisión + anomalías.
-- Phase 2A-3 · single-tenant (sin empresa_id; config_global ya tiene CUIT y
-- condición IVA). Habilita emisión fiscal A/B/C/E con CAE.
--
-- Cita el bagaje:
--   - doc 02 §3.5 (schema ARCA), §4.4 (E41 calcDoc), §4.8 (checklist edge fns).
--   - D01 (cola persistida + cron + Realtime), D02 (intervalo emisión),
--     D08 (SOAP request/response solo en rechazos, TTL 30d),
--     D14 (resiliencia retry transient + watchdog), E45 (RLS staff-only),
--     P-ARCA-01 (cache TA), P-ARCA-04 (ARCA como plugin opcional).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- arca_config · fila singleton (id=1). Configuración fiscal global.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arca_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ambiente text NOT NULL DEFAULT 'homologacion'
    CHECK (ambiente IN ('homologacion','produccion')),

  -- Material criptográfico (PEM b64). El private key NUNCA sale del backend.
  -- El CSR sólo existe entre "generar" y "subir cert"; lo conservamos para
  -- que el usuario pueda redescargarlo desde la UI.
  cert_b64 text,                          -- cert X.509 PEM firmado por AFIP (b64)
  key_b64 text,                           -- private key RSA PEM (b64)
  csr_b64 text,                           -- CSR PKCS#10 PEM (b64), guía visual
  csr_generado_at timestamptz,
  cert_subido_at timestamptz,
  cert_alias text,                        -- alias asignado en AFIP

  -- Metadatos del cert parseado (para mostrar vencimiento sin re-parsear).
  cert_valido_desde date,
  cert_valido_hasta date,

  -- Estado del último test de conexión.
  ultimo_test_at timestamptz,
  ultimo_test_ok boolean,
  ultimo_test_msg text,
  ultimo_test_latencia_ms integer,

  -- Punto de venta default que la UI propone al emitir fiscales.
  punto_venta_default int NOT NULL DEFAULT 1 CHECK (punto_venta_default > 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_arca_config_touch
  BEFORE UPDATE ON public.arca_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.arca_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.arca_config ENABLE ROW LEVEL SECURITY;

-- Solo staff puede leer (contiene material sensible aunque el client nunca
-- recibe el key crudo; aplicamos defensa en profundidad).
DROP POLICY IF EXISTS arca_config_select_staff ON public.arca_config;
CREATE POLICY arca_config_select_staff ON public.arca_config
  FOR SELECT TO authenticated USING (private.is_staff());

-- Solo gerentes pueden tocar la config (alta sensibilidad fiscal).
DROP POLICY IF EXISTS arca_config_update_gerente ON public.arca_config;
CREATE POLICY arca_config_update_gerente ON public.arca_config
  FOR UPDATE TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

-- ---------------------------------------------------------------------------
-- arca_tokens · cache del TA (Ticket de Acceso) de WSAA. ~12h de vida útil.
-- Una fila por servicio (default 'wsfe'). UNIQUE en service para UPSERT.
-- Nadie con rol authenticated debe leer/escribir esto; solo service_role
-- desde edge functions (P-ARCA-01).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arca_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL DEFAULT 'wsfe',
  ambiente text NOT NULL CHECK (ambiente IN ('homologacion','produccion')),
  token text NOT NULL,
  sign text NOT NULL,
  obtained_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_arca_tokens_service_ambiente
  ON public.arca_tokens(service, ambiente);
CREATE INDEX IF NOT EXISTS idx_arca_tokens_expires_at
  ON public.arca_tokens(expires_at DESC);

ALTER TABLE public.arca_tokens ENABLE ROW LEVEL SECURITY;
-- Sin policies → ningún rol authenticated puede leer/escribir.
-- service_role bypassa RLS y lo usa la edge function `arca-test-conexion`
-- y `arca-autorizar-comprobante`.

-- ---------------------------------------------------------------------------
-- arca_emision_queue · jobs de autorización. Una fila por comprobante a emitir.
-- D01 (cola + cron + Realtime). El idx único por (comprobante_id) WHERE status
-- IN ('pending','sending') garantiza idempotencia natural (no dos jobs activos
-- para el mismo comprobante).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arca_emision_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid NOT NULL
    REFERENCES public.comprobantes(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','done','failed','cancelled')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempt int NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts int NOT NULL DEFAULT 3,

  -- Debug · D08 (solo si rechazo, pero acá guardamos siempre del último intento).
  request_xml text,
  response_xml text,
  last_error text,

  -- Resultado de AFIP cuando OK.
  cae varchar(14),
  cae_vencimiento date,

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia natural: un comprobante no puede tener 2 jobs activos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_arca_queue_comprobante_activo
  ON public.arca_emision_queue(comprobante_id)
  WHERE status IN ('pending','sending');

-- Dispatcher: scan rápido de jobs pending vencidos.
CREATE INDEX IF NOT EXISTS idx_arca_queue_dispatch
  ON public.arca_emision_queue(status, scheduled_at)
  WHERE status = 'pending';

-- Watchdog: jobs colgados en 'sending'.
CREATE INDEX IF NOT EXISTS idx_arca_queue_sending
  ON public.arca_emision_queue(started_at)
  WHERE status = 'sending';

-- FK index (regla 11 / E48).
CREATE INDEX IF NOT EXISTS idx_arca_queue_comprobante
  ON public.arca_emision_queue(comprobante_id);

CREATE TRIGGER trg_arca_queue_touch
  BEFORE UPDATE ON public.arca_emision_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.arca_emision_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arca_queue_select_staff ON public.arca_emision_queue;
CREATE POLICY arca_queue_select_staff ON public.arca_emision_queue
  FOR SELECT TO authenticated USING (private.is_staff());

-- INSERT/UPDATE/DELETE quedan restringidos a service_role (edge functions).
-- El UI dispara inserts via RPC SECURITY DEFINER (enqueue_emision_comprobante).

-- ---------------------------------------------------------------------------
-- arca_anomalias · log de eventos raros para alertar. Cron de detección los
-- inserta; UI los lee y permite marcarlos como resueltos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arca_anomalias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN
    ('estancado','cert_proximo_vto','cert_vencido','tasa_fallos_alta',
     'afip_no_responde','watchdog_actuo','cert_invalido')),
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  resuelto_at timestamptz,
  resuelto_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arca_anomalias_pendientes
  ON public.arca_anomalias(created_at DESC) WHERE resuelto_at IS NULL;

ALTER TABLE public.arca_anomalias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arca_anomalias_select_staff ON public.arca_anomalias;
CREATE POLICY arca_anomalias_select_staff ON public.arca_anomalias
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS arca_anomalias_update_staff ON public.arca_anomalias;
CREATE POLICY arca_anomalias_update_staff ON public.arca_anomalias
  FOR UPDATE TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- RPC: enqueue_emision_comprobante(p_comprobante_id)
-- Inserta un job en arca_emision_queue si el comprobante existe, es fiscal
-- (A/B/C/E) y no tiene ya un job activo. SECURITY DEFINER (regla 12 — el
-- comprobante en single-tenant no requiere assert_administracion_access
-- porque sólo staff invoca esto desde el front).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_emision_comprobante(
  p_comprobante_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_job_id uuid;
  v_existing uuid;
  v_arca_listo boolean;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede encolar emisión ARCA';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  -- Tipos fiscales únicamente (X / NC_X / ND_X son simples y se autorizan
  -- en la misma RPC manual).
  IF v_comp.tipo NOT IN ('A','B','C','NC_A','NC_B','NC_C','ND_A','ND_B','ND_C') THEN
    RAISE EXCEPTION 'Tipo % no requiere autorización ARCA', v_comp.tipo;
  END IF;

  IF v_comp.cae IS NOT NULL THEN
    RAISE EXCEPTION 'El comprobante ya tiene CAE %', v_comp.cae;
  END IF;

  -- ARCA debe estar configurado (P-ARCA-04).
  SELECT (cert_b64 IS NOT NULL AND key_b64 IS NOT NULL AND COALESCE(ultimo_test_ok, false))
    INTO v_arca_listo FROM public.arca_config WHERE id = 1;
  IF NOT v_arca_listo THEN
    RAISE EXCEPTION 'ARCA no está configurado o el último test falló. Configurá ARCA en /gerencia/configuracion/arca';
  END IF;

  -- Idempotencia: si ya hay job activo, devolverlo.
  SELECT id INTO v_existing FROM public.arca_emision_queue
   WHERE comprobante_id = p_comprobante_id
     AND status IN ('pending','sending')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.arca_emision_queue (comprobante_id, status, scheduled_at)
  VALUES (p_comprobante_id, 'pending', now())
  RETURNING id INTO v_job_id;

  -- Mover comprobante a 'procesando' para feedback inmediato en UI.
  UPDATE public.comprobantes
     SET estado = 'procesando'
   WHERE id = p_comprobante_id AND estado IN ('borrador','error','rechazado');

  RETURN v_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_emision_comprobante(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_emision_comprobante(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reintentar_arca_job(p_job_id)
-- Pone un job failed/cancelled de vuelta en pending, reseteando attempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reintentar_arca_job(p_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede reintentar jobs ARCA';
  END IF;

  UPDATE public.arca_emision_queue
     SET status = 'pending',
         scheduled_at = now(),
         attempt = 0,
         last_error = NULL,
         started_at = NULL,
         finished_at = NULL
   WHERE id = p_job_id AND status IN ('failed','cancelled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job no encontrado o no está en estado failed/cancelled';
  END IF;

  RETURN p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reintentar_arca_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reintentar_arca_job(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reset_arca_jobs_colgados(p_max_age_min)
-- Watchdog: jobs en 'sending' por más de N minutos → vuelven a 'pending'.
-- Llamado por pg_cron cada 10 min. SECURITY DEFINER, sin auth check (sólo
-- service_role lo invoca via cron).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_arca_jobs_colgados(p_max_age_min int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE public.arca_emision_queue
       SET status = 'pending',
           scheduled_at = now(),
           started_at = NULL,
           last_error = COALESCE(last_error, '') ||
             format(E'\n[WATCHDOG] reset por estar en sending > %s min', p_max_age_min)
     WHERE status = 'sending'
       AND started_at < now() - make_interval(mins => p_max_age_min)
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  IF v_count > 0 THEN
    INSERT INTO public.arca_anomalias (tipo, detalle)
    VALUES ('watchdog_actuo', jsonb_build_object('jobs_reseteados', v_count, 'umbral_min', p_max_age_min));
  END IF;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_arca_jobs_colgados(int) FROM PUBLIC, anon;
-- service_role bypassa RLS pero no necesita GRANT explícito (es superusuario en JWT).
