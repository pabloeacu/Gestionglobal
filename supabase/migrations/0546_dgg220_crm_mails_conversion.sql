-- 0546_dgg220_crm_mails_conversion.sql
-- =============================================================================
-- DGG-220 · Fase 3 — CRM de prospectos: log de mails + detección automática de
-- conversión a cliente + helper de segmento por vencimiento.
--
-- - `prospecto_mails`: historial de comunicaciones por prospecto ("último mail").
--   Se puebla por trigger sobre `sent_emails` (match por email) → DRY, captura
--   cualquier envío real a un prospecto (campaña o webinar).
-- - Conversión automática: trigger sobre `administraciones` (INSERT/UPDATE de
--   cuit/email) → si un prospecto matchea por CUIT o email, se marca convertido
--   (sale de las campañas). Complementa el `convertir_prospecto_a_cliente` manual.
-- - `prospecto_segmento(venc, hoy)`: bucket de campaña (lo usan motor + UI).
-- =============================================================================

-- ---- Log de comunicaciones por prospecto ----
CREATE TABLE IF NOT EXISTS public.prospecto_mails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospecto_id  uuid NOT NULL REFERENCES public.prospectos(id) ON DELETE CASCADE,
  template_slug text,
  asunto        text,
  canal         text NOT NULL DEFAULT 'email',
  campana       text,
  enviado_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prospecto_mails ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospecto_mails TO authenticated;  -- R6
REVOKE ALL ON public.prospecto_mails FROM anon;
DROP POLICY IF EXISTS prospecto_mails_staff_all ON public.prospecto_mails;
CREATE POLICY prospecto_mails_staff_all ON public.prospecto_mails
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE INDEX IF NOT EXISTS idx_prospecto_mails_prospecto ON public.prospecto_mails(prospecto_id, enviado_at DESC);  -- R11 (FK) + orden

-- ---- Trigger: registrar cada envío real a un prospecto (sobre sent_emails) ----
-- R17: sent_emails/prospectos/prospecto_mails tienen RLS → SECURITY DEFINER.
CREATE OR REPLACE FUNCTION private.prospecto_registrar_mail()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_pid uuid;
BEGIN
  IF NEW.to_email IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_pid FROM public.prospectos WHERE email = lower(btrim(NEW.to_email)) LIMIT 1;
  IF v_pid IS NULL THEN RETURN NULL; END IF;  -- no es un prospecto (cliente/otro) → no-op
  INSERT INTO public.prospecto_mails (prospecto_id, template_slug, asunto, enviado_at)
  VALUES (v_pid, NEW.template_slug, NEW.asunto, COALESCE(NEW.enviado_at, now()));
  UPDATE public.prospectos
     SET ultimo_mail_slug = NEW.template_slug,
         ultimo_mail_asunto = NEW.asunto,
         ultimo_mail_at = COALESCE(NEW.enviado_at, now()),
         estado_captacion = CASE WHEN estado_captacion = 'nuevo' THEN 'contactado' ELSE estado_captacion END,
         updated_at = now()
   WHERE id = v_pid;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_prospecto_registrar_mail ON public.sent_emails;
CREATE TRIGGER trg_prospecto_registrar_mail
  AFTER INSERT ON public.sent_emails
  FOR EACH ROW EXECUTE FUNCTION private.prospecto_registrar_mail();

-- ---- Trigger: detección automática de conversión prospecto → cliente ----
CREATE OR REPLACE FUNCTION private.prospecto_detectar_conversion()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_cuit text; v_email text;
BEGIN
  v_cuit  := regexp_replace(COALESCE(NEW.cuit, ''), '[^0-9]', '', 'g');
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_cuit = '' AND v_email = '' THEN RETURN NULL; END IF;
  UPDATE public.prospectos p
     SET convertido_a_administracion_id = NEW.id,
         convertido_at = COALESCE(p.convertido_at, now()),
         estado_captacion = 'convertido',
         updated_at = now()
   WHERE p.convertido_a_administracion_id IS NULL
     AND ( (v_cuit <> '' AND p.cuit = v_cuit)
        OR (v_email <> '' AND p.email = v_email) );
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_prospecto_detectar_conversion ON public.administraciones;
CREATE TRIGGER trg_prospecto_detectar_conversion
  AFTER INSERT OR UPDATE OF cuit, email ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION private.prospecto_detectar_conversion();

-- Backfill retroactivo (los clientes actuales se excluyeron en el import → se espera 0,
-- pero es idempotente por si algún prospecto ya coincide con un cliente existente).
UPDATE public.prospectos p
   SET convertido_a_administracion_id = a.id, convertido_at = now(), estado_captacion = 'convertido', updated_at = now()
  FROM public.administraciones a
 WHERE p.convertido_a_administracion_id IS NULL
   AND ( (p.cuit IS NOT NULL AND p.cuit <> '' AND p.cuit = regexp_replace(COALESCE(a.cuit,''),'[^0-9]','','g'))
      OR (p.email IS NOT NULL AND p.email = lower(btrim(COALESCE(a.email,'')))) );

-- ---- Helper: segmento de campaña por vencimiento (lo usan motor + UI) ----
CREATE OR REPLACE FUNCTION public.prospecto_segmento(p_venc date, p_hoy date)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_venc IS NULL THEN 'sin_dato'
    WHEN p_venc < p_hoy THEN 'vencida'
    WHEN p_venc <= p_hoy + 30 THEN 'curso_reno_30'
    WHEN p_venc <= p_hoy + 90 THEN 'curso_31_90'
    ELSE 'vigente_lejos'
  END;
$fn$;

-- Hardening §6 B#4: acotar los estados de captación válidos (texto libre → CHECK).
-- Estados manuales de CRM (interesado/no_interesado) + automáticos (contactado/convertido/baja).
ALTER TABLE public.prospectos
  ADD CONSTRAINT prospectos_estado_captacion_chk
  CHECK (estado_captacion IN ('nuevo','contactado','interesado','no_interesado','convertido','baja'));

-- NOTA Fase 4 (elegibilidad de campaña, fuente canónica = timestamps, no el string):
--   WHERE convertido_at IS NULL AND baja_at IS NULL AND email NOT LIKE '%@padron.invalid'
--   (+ no suprimido + cooldown por prospecto_mails + segmento por prospecto_segmento()).

-- §6 A: alinear el RPC de conversión MANUAL para que también setee estado_captacion
-- (antes sólo seteaba los timestamps → divergencia con el trigger automático).
CREATE OR REPLACE FUNCTION public.convertir_prospecto_a_cliente(p_prospecto_id uuid, p_administracion_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.prospectos
     SET convertido_a_administracion_id = p_administracion_id,
         convertido_at = now(), estado_captacion = 'convertido', updated_at = now()
   WHERE id = p_prospecto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prospecto_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.webinar_inscriptos
     SET administracion_id = p_administracion_id, prospecto_id = NULL
   WHERE prospecto_id = p_prospecto_id;
END;
$function$;
