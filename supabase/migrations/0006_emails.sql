-- ============================================================================
-- 0006_emails · email_queue + sent_emails + email_plantillas + helper
-- next_email_slot (throttle global hard 5 min — E42 / D05).
-- Cita el bagaje: doc 02 §3.6 / §5 (throttle, dedup), E43 (naming híbrido:
-- sent_emails.enviado_at y .asunto, no sent_at / subject), D09 (Idempotency-Key
-- a Resend), MDC-29 (DKIM/SPF/DMARC del dominio).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- email_queue · cola persistida. La procesa un cron + edge function.
-- ---------------------------------------------------------------------------
CREATE TABLE public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lote (envío masivo de comprobantes)
  lote_id uuid REFERENCES public.lotes_facturacion(id) ON DELETE CASCADE,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE CASCADE,
  comprobante_ids uuid[] NOT NULL DEFAULT '{}',
  parte int NOT NULL DEFAULT 1,
  partes_total int NOT NULL DEFAULT 1,

  -- Tipo de email (lote, individual, trámites, etc.)
  kind text NOT NULL DEFAULT 'lote' CHECK (kind IN (
    'lote','individual','tramite','reclamo','curso','notificacion','sistema'
  )),
  html_body text,
  attachments_jsonb jsonb,
  plantilla_tipo text,
  reply_to text,

  -- Vínculos opcionales (para individual / reclamo / trámite)
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,

  -- Destinatarios
  to_email text NOT NULL,
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,

  -- Programación + estado
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','scheduled','sending','sent','failed','too_large','cancelled'
  )),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts > 0),

  -- Resultado
  resend_id text,
  sent_at timestamptz,
  zip_size_bytes bigint,
  error_msg text,
  sending_started_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT chk_email_queue_kind_consistency CHECK (
    (kind = 'lote' AND lote_id IS NOT NULL AND administracion_id IS NOT NULL)
    OR (kind <> 'lote' AND html_body IS NOT NULL)
  )
);

CREATE INDEX idx_email_queue_dispatch
  ON public.email_queue(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_email_queue_lote
  ON public.email_queue(lote_id, status) WHERE lote_id IS NOT NULL;
CREATE INDEX idx_email_queue_admin
  ON public.email_queue(administracion_id, status)
  WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_email_queue_sending
  ON public.email_queue(sending_started_at) WHERE status = 'sending';

CREATE TRIGGER trg_email_queue_touch
  BEFORE UPDATE ON public.email_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sent_emails · cada envío exitoso (o fallido tras agotar reintentos).
-- Naming híbrido E43: enviado_at y asunto, no sent_at / subject.
-- ---------------------------------------------------------------------------
CREATE TABLE public.sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  cc text,
  from_email text NOT NULL DEFAULT 'contacto@gestionglobal.ar',
  reply_to text,
  asunto text NOT NULL,
  plantilla text,
  html text,
  attachments_meta jsonb,
  resend_id text UNIQUE,
  estado text NOT NULL DEFAULT 'sent' CHECK (estado IN (
    'sent','delivered','bounced','complained','delivery_delayed','failed','opened','clicked'
  )),
  enviado_at timestamptz NOT NULL DEFAULT now(),
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_event_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  zip_attached boolean,
  importe_total numeric(14,2),
  attachments_filenames text[],
  error_code text,
  error_msg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_sent_emails_enviado_at ON public.sent_emails(enviado_at DESC);
CREATE INDEX idx_sent_emails_resend_id
  ON public.sent_emails(resend_id) WHERE resend_id IS NOT NULL;
CREATE INDEX idx_sent_emails_administracion
  ON public.sent_emails(administracion_id, enviado_at DESC)
  WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_sent_emails_comprobante
  ON public.sent_emails(comprobante_id)
  WHERE comprobante_id IS NOT NULL;

CREATE TRIGGER trg_sent_emails_touch
  BEFORE UPDATE ON public.sent_emails
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- email_plantillas · plantillas reutilizables (TipTap → HTML al guardar).
-- ---------------------------------------------------------------------------
CREATE TABLE public.email_plantillas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL UNIQUE CHECK (tipo IN (
    'comprobante','recordatorio','notificacion',
    'recordatorio_1','recordatorio_2','recordatorio_3',
    'intimacion','escalado_legal',
    'tramite_alta','tramite_avance','tramite_cierre',
    'curso_acceso','curso_recordatorio',
    'bienvenida','restablecer_password'
  )),
  kicker text NOT NULL DEFAULT '',
  titulo text NOT NULL DEFAULT '',
  cuerpo text NOT NULL DEFAULT '',
  firma text,
  color_acento text NOT NULL DEFAULT '#009eca'
    CHECK (color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  mostrar_logo boolean NOT NULL DEFAULT true,
  mostrar_datos boolean NOT NULL DEFAULT true,
  cta_label text,
  cta_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_email_plantillas_touch
  BEFORE UPDATE ON public.email_plantillas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- next_email_slot · piso hardcoded 5 min entre envíos (E42 / D05). En schema
-- `private` para no exponerlo por PostgREST; las RPCs SECURITY DEFINER que
-- encolen mails lo usarán como fuente única de verdad del throttle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.next_email_slot()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    now() + interval '1 minute',
    COALESCE((
      SELECT MAX(scheduled_at) FROM public.email_queue
       WHERE status IN ('pending','scheduled','sending')
    ) + interval '5 minutes', now()),
    COALESCE((
      SELECT MAX(enviado_at) FROM public.sent_emails
    ) + interval '5 minutes', now())
  );
$$;
REVOKE EXECUTE ON FUNCTION private.next_email_slot() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION private.next_email_slot() TO authenticated;

-- ---------------------------------------------------------------------------
-- apply_resend_event · idempotencia de webhooks Resend (doc 02 §5.5)
-- Aplica un evento (delivered/bounced/opened/...) sobre sent_emails sin dupe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_resend_event(
  p_resend_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_data jsonb
) RETURNS TABLE(sent_email_id uuid, applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_exists boolean;
BEGIN
  SELECT id INTO v_id FROM public.sent_emails WHERE resend_id = p_resend_id;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(events) e
     WHERE e->>'type' = p_event_type
       AND (e->>'at')::timestamptz = p_event_at
  ) INTO v_exists FROM public.sent_emails WHERE id = v_id;

  IF v_exists THEN
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;

  UPDATE public.sent_emails SET
    events = events || jsonb_build_array(jsonb_build_object(
      'type', p_event_type, 'at', p_event_at, 'data', p_data)),
    last_event_at = GREATEST(COALESCE(last_event_at, '-infinity'::timestamptz), p_event_at),
    delivered_at = CASE WHEN p_event_type = 'delivered' THEN p_event_at ELSE delivered_at END,
    bounced_at   = CASE WHEN p_event_type = 'bounced'   THEN p_event_at ELSE bounced_at END,
    complained_at= CASE WHEN p_event_type = 'complained' THEN p_event_at ELSE complained_at END,
    opened_at    = CASE WHEN p_event_type = 'opened' AND opened_at IS NULL THEN p_event_at ELSE opened_at END,
    clicked_at   = CASE WHEN p_event_type = 'clicked' AND clicked_at IS NULL THEN p_event_at ELSE clicked_at END,
    estado = CASE
      WHEN p_event_type IN ('bounced','complained') THEN p_event_type
      WHEN p_event_type = 'delivered' AND estado = 'sent' THEN 'delivered'
      ELSE estado
    END
  WHERE id = v_id;

  RETURN QUERY SELECT v_id, true;
END;
$$;
-- Sólo invocable por service-role desde la edge function resend-webhook
REVOKE EXECUTE ON FUNCTION public.apply_resend_event(text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_queue_select_staff ON public.email_queue;
CREATE POLICY email_queue_select_staff ON public.email_queue
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS email_queue_write_staff ON public.email_queue;
CREATE POLICY email_queue_write_staff ON public.email_queue
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sent_emails_select ON public.sent_emails;
CREATE POLICY sent_emails_select ON public.sent_emails
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (private.is_administrador()
        AND administracion_id = private.current_administracion_id())
  );
DROP POLICY IF EXISTS sent_emails_write_staff ON public.sent_emails;
CREATE POLICY sent_emails_write_staff ON public.sent_emails
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

ALTER TABLE public.email_plantillas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_plantillas_select_staff ON public.email_plantillas;
CREATE POLICY email_plantillas_select_staff ON public.email_plantillas
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS email_plantillas_write_gerente ON public.email_plantillas;
CREATE POLICY email_plantillas_write_gerente ON public.email_plantillas
  FOR ALL TO authenticated
  USING (private.is_gerente()) WITH CHECK (private.is_gerente());
