-- ============================================================================
-- 0042_p5_resto · Migración consolidada del segundo pase del Punto 5 (L/M).
--
-- Agrupa todos los cambios de schema que necesitan los items L/M restantes:
--   · 1.F  RPC public.restaurar_solicitud(id) — revierte un descarte.
--   · 1.H  sent_emails.solicitud_id (FK) + template 'solicitud-respuesta-libre'
--           + RPC public.solicitud_responder(...) que encola + audita.
--   · 2.D  servicios.sla_dias (int, default NULL) — SLA esperado del servicio.
--   · 5.B  tramites.responsable_id (FK profiles) + trigger backfill desde
--           asignado_a, para exponer "Tu contacto" en el acceso externo.
--   · 5.C  tabla public.accesos_externos_log (apertura pública sin login) +
--           RPC public.registrar_apertura_acceso(...) ejecutable por anon.
--
-- Reglas: 2 (RLS), 5 (multi-tabla → RPC SD), 6 (versionado), 8/E43 (naming
-- híbrido: sent_emails usa `asunto`/`enviado_at`), 12 (tenancy guard donde el
-- recurso es de una administración).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1.F · RPC restaurar_solicitud(id)
--   Revierte el estado de una solicitud descartada. Como el modelo no guarda
--   el estado previo explícito, restauramos a un estado coherente:
--     - 'derivada'    si ya tuvo al menos una derivación,
--     - 'en_revision' si tiene observaciones internas o estuvo asignada,
--     - 'recibida'    en caso contrario.
--   Limpia `motivo_descarte`. Sólo staff.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_solicitud(
  p_solicitud_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol         public.solicitudes%ROWTYPE;
  v_tiene_deriv boolean;
  v_nuevo       text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.estado <> 'descartada' THEN
    -- No-op idempotente: si no estaba descartada, devolvemos su estado actual.
    RETURN v_sol.estado;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.solicitud_derivaciones WHERE solicitud_id = p_solicitud_id
  ) INTO v_tiene_deriv;

  v_nuevo := CASE
    WHEN v_tiene_deriv THEN 'derivada'
    WHEN COALESCE(btrim(v_sol.observaciones), '') <> '' OR v_sol.asignada_a IS NOT NULL THEN 'en_revision'
    ELSE 'recibida'
  END;

  UPDATE public.solicitudes
     SET estado = v_nuevo,
         motivo_descarte = NULL
   WHERE id = p_solicitud_id;

  RETURN v_nuevo;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restaurar_solicitud(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.restaurar_solicitud(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1.H · sent_emails.solicitud_id + template + RPC solicitud_responder
-- ---------------------------------------------------------------------------
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS solicitud_id uuid
    REFERENCES public.solicitudes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_solicitud
  ON public.sent_emails(solicitud_id, enviado_at DESC)
  WHERE solicitud_id IS NOT NULL;

COMMENT ON COLUMN public.sent_emails.solicitud_id IS
  '1.H · vincula la respuesta enviada desde la plataforma a la solicitud (historial).';

-- email_queue también necesita poder relacionarse con la solicitud para que el
-- dispatcher loguee correctamente al moverlo a sent_emails (reusa related_*).
-- Ya existen related_table/related_id (mig 0024), así que no agregamos columnas.

-- Template genérico de respuesta libre. El asunto y el cuerpo son variables;
-- así una sola plantilla sirve para cualquier respuesta manual. El layout
-- mantiene el branding mínimo (header + firma).
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES (
  'solicitud-respuesta-libre',
  'Respuesta a solicitud (libre)',
  '{{asunto}}',
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">'
    || '<div style="border-bottom:3px solid #009eca;padding:12px 0;font-weight:700;font-size:18px">Gestión Global</div>'
    || '<div style="padding:18px 0;white-space:pre-wrap;line-height:1.6;font-size:15px">{{cuerpo}}</div>'
    || '<div style="border-top:1px solid #e2e8f0;padding-top:12px;color:#64748b;font-size:12px">'
    || 'Gestión Global · gestionglobal.ar — Este mensaje responde a tu solicitud.</div>'
    || '</div>',
  E'{{cuerpo}}\n\n— Gestión Global · gestionglobal.ar',
  'tramites',
  '1.H · Respuesta manual del equipo a una solicitud, redactada desde la plataforma.',
  '["asunto","cuerpo"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- RPC: responde una solicitud. Encola el email (motor Workflow / Workspace) y
-- registra el envío en sent_emails ligado a la solicitud para historial. El
-- FROM se elige por casilla (alias del dominio) — validado contra el set de
-- email_templates.from_casilla permitido.
CREATE OR REPLACE FUNCTION public.solicitud_responder(
  p_solicitud_id uuid,
  p_asunto       text,
  p_cuerpo       text,
  p_from_casilla text DEFAULT 'tramites'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol      public.solicitudes%ROWTYPE;
  v_to       text;
  v_from     text;
  v_email_q  uuid;
  v_sent_id  uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  IF p_from_casilla NOT IN ('info','cursos','facturacion','tramites','recupero') THEN
    RAISE EXCEPTION 'Casilla inválida: %', p_from_casilla USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_asunto), '') = '' OR COALESCE(btrim(p_cuerpo), '') = '' THEN
    RAISE EXCEPTION 'Asunto y cuerpo son obligatorios' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  v_to := v_sol.solicitante_email;
  IF COALESCE(btrim(v_to), '') = '' THEN
    RAISE EXCEPTION 'La solicitud no tiene email del solicitante' USING ERRCODE = '22023';
  END IF;

  v_from := p_from_casilla || '@gestionglobal.ar';

  -- Encolar vía motor Workflow (la edge function dispatch-emails lo envía por
  -- Workspace y mueve a sent_emails). Reusamos encolar_email (regla 5) con el
  -- template genérico de respuesta libre. El FROM efectivo lo determina la
  -- casilla del template; lo elegido por el usuario queda registrado en
  -- sent_emails.from_email como historial visible para gerencia.
  v_email_q := public.encolar_email(
    'solicitud-respuesta-libre',
    v_to,
    COALESCE(v_sol.solicitante_nombre, split_part(v_to,'@',1)),
    jsonb_build_object('asunto', p_asunto, 'cuerpo', p_cuerpo),
    NULL, NULL,
    'solicitudes', p_solicitud_id,
    2::smallint
  );

  -- Registro inmediato en sent_emails (estado 'sent' optimista; el dispatcher
  -- actualizará el estado real al procesar la cola). Ligado a la solicitud.
  INSERT INTO public.sent_emails (
    to_email, from_email, asunto, plantilla, estado, solicitud_id, created_by
  ) VALUES (
    v_to, v_from, p_asunto, 'solicitud-respuesta-libre', 'sent',
    p_solicitud_id, auth.uid()
  )
  RETURNING id INTO v_sent_id;

  RETURN v_sent_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.solicitud_responder(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_responder(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4.A · formularios.schema_draft — autosave sin versionar
--   El trigger formulario_versionado (mig 0034) crea un snapshot CADA vez que
--   cambia `schema`. Para el autosave (debounce 1500ms) eso inflaría el
--   historial. Solución: el autosave persiste en `schema_draft` (NO versiona),
--   y "Guardar versión" copia draft→schema (SÍ versiona). Al cargar el builder
--   preferimos el draft si es más nuevo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.formularios
  ADD COLUMN IF NOT EXISTS schema_draft jsonb,
  ADD COLUMN IF NOT EXISTS schema_draft_at timestamptz;

COMMENT ON COLUMN public.formularios.schema_draft IS
  '4.A · borrador de autosave del builder. Se promueve a schema (y versiona) al "Guardar versión".';

-- ---------------------------------------------------------------------------
-- 2.D · servicios.sla_dias
-- ---------------------------------------------------------------------------
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS sla_dias int
    CHECK (sla_dias IS NULL OR (sla_dias > 0 AND sla_dias <= 3650));

COMMENT ON COLUMN public.servicios.sla_dias IS
  '2.D · SLA esperado del servicio en días, para el indicador de progreso en el header del tracking. NULL = sin SLA.';

-- ---------------------------------------------------------------------------
-- 5.B · tramites.responsable_id + backfill desde asignado_a
-- ---------------------------------------------------------------------------
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS responsable_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tramites_responsable
  ON public.tramites(responsable_id) WHERE responsable_id IS NOT NULL;

COMMENT ON COLUMN public.tramites.responsable_id IS
  '5.B · gerente/operador responsable del tracking — se muestra como "Tu contacto" en el acceso externo. Backfill desde asignado_a.';

-- Backfill inicial.
UPDATE public.tramites
   SET responsable_id = asignado_a
 WHERE responsable_id IS NULL AND asignado_a IS NOT NULL;

-- Trigger: si se crea/actualiza un tracking sin responsable explícito, lo
-- deriva de asignado_a (mantiene el contacto sincronizado sin pisar overrides).
CREATE OR REPLACE FUNCTION public.tramites_sync_responsable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.responsable_id IS NULL AND NEW.asignado_a IS NOT NULL THEN
    NEW.responsable_id := NEW.asignado_a;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tramites_sync_responsable ON public.tramites;
CREATE TRIGGER trg_tramites_sync_responsable
  BEFORE INSERT OR UPDATE OF asignado_a, responsable_id ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.tramites_sync_responsable();

-- ---------------------------------------------------------------------------
-- 5.C · accesos_externos_log (apertura pública) + RPC anon
--
-- Log liviano de aperturas del link público. Insert desde el front (anon) vía
-- RPC SECURITY DEFINER que sólo permite registrar (no leer). Lectura: staff.
-- PII: la IP la guardamos truncada (sin último octeto) — privacidad por diseño.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accesos_externos_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  abierto_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_acc_log_token
  ON public.accesos_externos_log(token, abierto_at DESC);

ALTER TABLE public.accesos_externos_log ENABLE ROW LEVEL SECURITY;

-- Lectura: sólo staff (la gerencia ve el badge "Visto N veces").
DROP POLICY IF EXISTS acc_log_select_staff ON public.accesos_externos_log;
CREATE POLICY acc_log_select_staff ON public.accesos_externos_log
  FOR SELECT TO authenticated USING (private.is_staff());

-- Nadie escribe directo por RLS; el insert va por la RPC SD de abajo.
COMMENT ON TABLE public.accesos_externos_log IS
  '5.C · log de aperturas del acceso externo público. Se inserta vía RPC anon registrar_apertura_acceso. IP truncada por privacidad.';

-- RPC ejecutable por anon: registra la apertura si el token existe y está
-- vivo. No revela nada (RETURNS void). Trunca la IP al /24 (IPv4) para no
-- guardar el host exacto.
CREATE OR REPLACE FUNCTION public.registrar_apertura_acceso(
  p_token      text,
  p_user_agent text DEFAULT NULL,
  p_ip         text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe boolean;
  v_ip     text;
BEGIN
  -- Token debe ser hex 32..128 (mismo formato que generar_acceso_externo).
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{32,128}$' THEN
    RETURN;  -- silencioso: no exponemos validez del token
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.accesos_externos
     WHERE token = p_token
       AND revocado_at IS NULL
       AND vence_at > now()
  ) INTO v_existe;
  IF NOT v_existe THEN
    RETURN;
  END IF;

  -- Trunca IPv4 al /24 (oculta el último octeto). IPv6 / otros: guardamos NULL.
  v_ip := NULL;
  IF p_ip ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' THEN
    v_ip := regexp_replace(p_ip, '\.\d{1,3}$', '.0');
  END IF;

  INSERT INTO public.accesos_externos_log (token, ip, user_agent)
  VALUES (p_token, v_ip, left(COALESCE(p_user_agent, ''), 300));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_apertura_acceso(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.registrar_apertura_acceso(text, text, text) TO anon, authenticated;

-- Vista de resumen por token para la lista de accesos en gerencia: total de
-- aperturas + última apertura. Lectura limitada a staff via la tabla base.
CREATE OR REPLACE VIEW public.vw_accesos_externos_aperturas
WITH (security_invoker = true) AS
  SELECT token,
         count(*)::int    AS total_aperturas,
         max(abierto_at)  AS ultima_apertura
    FROM public.accesos_externos_log
   GROUP BY token;

COMMENT ON VIEW public.vw_accesos_externos_aperturas IS
  '5.C · agregado de aperturas por token (badge "Visto N veces · última hace Xh").';
