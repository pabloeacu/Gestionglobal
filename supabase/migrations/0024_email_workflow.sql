-- ============================================================================
-- 0024_email_workflow · Sistema de email completo (workflow flexible).
--
-- El 0006_emails creó `email_queue` y `sent_emails` orientados al caso de
-- comprobantes / lotes (con `kind`, `comprobante_ids[]`, `subject` inline,
-- `html_body` precomputado). Acá agregamos el sistema GENÉRICO de templates
-- + variables + cola con prioridad + throttle global persistido, manteniendo
-- compatibilidad: extendemos `email_queue` y `sent_emails` con columnas
-- adicionales en vez de duplicar.
--
-- Citas:
--   · regla 1 (persistencia BD), regla 2 (RLS día 1), regla 5 (RPC SD multi-
--     tabla), regla 8 (E43 naming híbrido: enviado_at / asunto).
--   · D05 / E42 · throttle global hard 5 min (acá lo persistimos en
--     `email_throttle` para que sea robusto a deploys y se vea desde la UI).
--   · D10 · splitter inverso → `lote_consolidado_administracion` reusa email
--     del mismo template+administracion si todavía no fue enviado.
--   · E45 / E49 · guard de tenancy en RPCs SD que reciban administracion_id.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- email_templates · plantillas reutilizables por slug (vs `email_plantillas`
-- legacy del 0006 que usa `tipo` con CHECK fijo). El nuevo motor genérico
-- usa slug libre + variables tipadas → más flexible para nuevos flujos
-- (formularios, campus, recupero) sin tener que migrar el enum.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  nombre       text NOT NULL,
  asunto       text NOT NULL,
  body_html    text NOT NULL,
  body_text    text,
  from_casilla text NOT NULL DEFAULT 'info'
    CHECK (from_casilla IN ('info','cursos','facturacion','tramites','recupero')),
  reply_to     text,
  descripcion  text,
  activo       boolean NOT NULL DEFAULT true,
  variables    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_email_templates_touch ON public.email_templates;
CREATE TRIGGER trg_email_templates_touch
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_email_templates_slug ON public.email_templates(slug);
CREATE INDEX IF NOT EXISTS idx_email_templates_activo
  ON public.email_templates(activo) WHERE activo = true;

-- ---------------------------------------------------------------------------
-- email_queue · extensiones para el motor genérico. No tocamos el schema
-- existente (NOT NULLs para casos legacy). Las columnas nuevas son nullable
-- para coexistir con jobs `kind=lote` previos.
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS template_slug    text REFERENCES public.email_templates(slug)
                            ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_nombre        text,
  ADD COLUMN IF NOT EXISTS variables        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prioridad        smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS programado_para  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS enviado_at       timestamptz,
  ADD COLUMN IF NOT EXISTS intento          smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_intentos     smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ultimo_error     text,
  ADD COLUMN IF NOT EXISTS related_table    text,
  ADD COLUMN IF NOT EXISTS related_id       uuid;

-- Permitimos jobs del nuevo motor con `subject` derivado del template; si
-- arranca NULL, lo resolverá el dispatcher al renderear. Para mantener el
-- CHECK original (`html_body NOT NULL` para `kind <> lote`) introducimos un
-- nuevo kind 'workflow' que indica que el contenido se renderea del template.
DO $$
BEGIN
  -- relaja NOT NULL de subject sólo si todavía está NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='email_queue'
                AND column_name='subject' AND is_nullable='NO') THEN
    ALTER TABLE public.email_queue ALTER COLUMN subject DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='email_queue'
                AND column_name='scheduled_at' AND is_nullable='NO') THEN
    ALTER TABLE public.email_queue ALTER COLUMN scheduled_at DROP NOT NULL;
  END IF;
END $$;

-- Drop del CHECK rígido legacy y reemplazo por uno que admita workflow:
ALTER TABLE public.email_queue
  DROP CONSTRAINT IF EXISTS chk_email_queue_kind_consistency;
ALTER TABLE public.email_queue
  DROP CONSTRAINT IF EXISTS email_queue_kind_check;
ALTER TABLE public.email_queue
  ADD CONSTRAINT email_queue_kind_check CHECK (kind IN (
    'lote','individual','tramite','reclamo','curso','notificacion','sistema','workflow'
  ));
ALTER TABLE public.email_queue
  ADD CONSTRAINT chk_email_queue_kind_consistency CHECK (
    (kind = 'lote' AND lote_id IS NOT NULL AND administracion_id IS NOT NULL)
    OR (kind = 'workflow' AND template_slug IS NOT NULL AND to_email IS NOT NULL)
    OR (kind NOT IN ('lote','workflow') AND html_body IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_email_queue_dispatch_workflow
  ON public.email_queue(prioridad, programado_para)
  WHERE enviado_at IS NULL AND kind = 'workflow';

CREATE INDEX IF NOT EXISTS idx_email_queue_template
  ON public.email_queue(template_slug) WHERE template_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_queue_related
  ON public.email_queue(related_table, related_id)
  WHERE related_table IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sent_emails · columnas extras para el motor genérico.
-- (`provider_msg_id` reemplaza a `resend_id` semánticamente, pero coexisten;
--  `webhook_status` se actualiza desde Gmail History o Resend webhooks.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS template_slug   text,
  ADD COLUMN IF NOT EXISTS from_casilla    text,
  ADD COLUMN IF NOT EXISTS provider_msg_id text,
  ADD COLUMN IF NOT EXISTS webhook_status  text
    CHECK (webhook_status IS NULL OR webhook_status IN (
      'enviado','entregado','abierto','clickeado','rebotado'
    ));

CREATE INDEX IF NOT EXISTS idx_sent_emails_provider_msg
  ON public.sent_emails(provider_msg_id) WHERE provider_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sent_emails_template
  ON public.sent_emails(template_slug) WHERE template_slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- email_throttle · estado del throttle global hard 5 min (E42/D05). Una fila
-- por key (la key principal es 'global'; permite también throttles por
-- casilla en el futuro: 'casilla:info', etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_throttle (
  key            text PRIMARY KEY,
  last_sent_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_throttle_select_staff ON public.email_throttle;
CREATE POLICY email_throttle_select_staff ON public.email_throttle
  FOR SELECT TO authenticated USING (private.is_staff());

-- ---------------------------------------------------------------------------
-- RLS extra para email_templates · staff lee, gerente escribe.
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_select_staff ON public.email_templates;
CREATE POLICY email_templates_select_staff ON public.email_templates
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS email_templates_insert_gerente ON public.email_templates;
CREATE POLICY email_templates_insert_gerente ON public.email_templates
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
DROP POLICY IF EXISTS email_templates_update_gerente ON public.email_templates;
CREATE POLICY email_templates_update_gerente ON public.email_templates
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
DROP POLICY IF EXISTS email_templates_delete_gerente ON public.email_templates;
CREATE POLICY email_templates_delete_gerente ON public.email_templates
  FOR DELETE TO authenticated USING (private.is_gerente());

-- ---------------------------------------------------------------------------
-- RLS extra para sent_emails · admin lee SOLO los emails de su administración.
-- Las policies del 0006/0006a ya cubren staff + administrador filtrado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RPC: encolar_email · API pública para encolar un email a partir de un
-- template + variables. SD con guard de tenancy si viene administracion_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encolar_email(
  p_template          text,
  p_to_email          text,
  p_to_nombre         text,
  p_variables         jsonb,
  p_administracion_id uuid,
  p_consorcio_id      uuid,
  p_related_table     text,
  p_related_id        uuid,
  p_prioridad         smallint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tpl public.email_templates%ROWTYPE;
  v_id  uuid;
BEGIN
  -- Tenancy guard (regla 12 · E45/E49).
  IF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  SELECT * INTO v_tpl FROM public.email_templates
   WHERE slug = p_template AND activo = true;
  IF v_tpl.slug IS NULL THEN
    RAISE EXCEPTION 'Template % no existe o inactivo', p_template
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_queue (
    kind, template_slug, to_email, to_nombre,
    variables, prioridad, programado_para,
    administracion_id, consorcio_id,
    related_table, related_id,
    subject, scheduled_at,
    -- legacy NOT NULLs (todavía requeridos por la tabla):
    comprobante_ids, parte, partes_total
  ) VALUES (
    'workflow', v_tpl.slug, p_to_email, p_to_nombre,
    COALESCE(p_variables, '{}'::jsonb), COALESCE(p_prioridad, 5::smallint), now(),
    p_administracion_id, p_consorcio_id,
    p_related_table, p_related_id,
    v_tpl.asunto, now(),
    '{}'::uuid[], 1, 1
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encolar_email(text,text,text,jsonb,uuid,uuid,text,uuid,smallint)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: lote_consolidado_administracion · splitter inverso (D10). Si hay un
-- email del MISMO template + MISMA administracion todavía no enviado, devuelve
-- ese id en vez de crear uno nuevo. La idea: si el sistema dispara 3 eventos
-- en 2 min para la misma admin, mandamos UN solo email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lote_consolidado_administracion(
  p_administracion_id uuid,
  p_template          text,
  p_variables         jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_admin  public.administraciones%ROWTYPE;
  v_to     text;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  -- ¿Hay uno pendiente?
  SELECT id INTO v_id
    FROM public.email_queue
   WHERE template_slug = p_template
     AND administracion_id = p_administracion_id
     AND enviado_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- merge superficial de variables (jsonb_concat — el nuevo gana).
    UPDATE public.email_queue
       SET variables = COALESCE(variables, '{}'::jsonb) || COALESCE(p_variables, '{}'::jsonb)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_admin FROM public.administraciones
   WHERE id = p_administracion_id;
  v_to := v_admin.email;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'Administración % no tiene email cargado', p_administracion_id
      USING ERRCODE = '23502';
  END IF;

  v_id := public.encolar_email(
    p_template, v_to, v_admin.nombre, p_variables,
    p_administracion_id, NULL, 'administraciones', p_administracion_id, 5::smallint
  );
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.lote_consolidado_administracion(uuid,text,jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lote_consolidado_administracion(uuid,text,jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed inicial de templates (8) · idempotente por slug.
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES
 ('bienvenida-administracion',
  'Bienvenida a Administración',
  'Bienvenido a Gestión Global, {{nombre_administracion}}',
  '<h2>Hola {{nombre_administracion}}</h2><p>Te damos la bienvenida a Gestión Global. Ya podés ingresar al portal con tu email.</p><p>Ante cualquier duda respondé este mismo correo.</p><p><strong>Gestión Global</strong></p>',
  'Hola {{nombre_administracion}}, te damos la bienvenida a Gestión Global.',
  'info', 'Mail de bienvenida al alta de una administración.',
  '["nombre_administracion"]'::jsonb),

 ('tramite-creado',
  'Trámite creado',
  'Recibimos tu trámite #{{numero}}',
  '<h2>Tu trámite fue recibido</h2><p>Hola {{nombre}}, recibimos tu trámite <strong>#{{numero}}</strong> sobre {{asunto}}. Te avisamos apenas tengamos novedades.</p>',
  'Recibimos tu trámite #{{numero}} ({{asunto}}).',
  'tramites', 'Confirmación al crearse un trámite.',
  '["nombre","numero","asunto"]'::jsonb),

 ('tramite-resuelto',
  'Trámite resuelto',
  'Tu trámite #{{numero}} fue resuelto',
  '<h2>¡Listo!</h2><p>Hola {{nombre}}, resolvimos tu trámite <strong>#{{numero}}</strong>.</p><p><em>{{detalle_cierre}}</em></p>',
  'Tu trámite #{{numero}} fue resuelto. {{detalle_cierre}}',
  'tramites', 'Aviso de cierre/resolución de trámite.',
  '["nombre","numero","detalle_cierre"]'::jsonb),

 ('comprobante-emitido',
  'Comprobante emitido',
  'Comprobante {{tipo}} {{numero}}',
  '<h2>Comprobante {{tipo}} {{numero}}</h2><p>Hola {{nombre}}, adjuntamos el comprobante <strong>{{tipo}} {{numero}}</strong> por {{total}}. Vence el {{vencimiento}}.</p>',
  'Comprobante {{tipo}} {{numero}} por {{total}} · vence {{vencimiento}}.',
  'facturacion', 'Notificación de comprobante emitido (sin adjunto desde este motor — los PDFs los maneja send-comprobante-email).',
  '["nombre","tipo","numero","total","vencimiento"]'::jsonb),

 ('recordatorio-vencimiento-30d',
  'Recordatorio vencimiento 30 días',
  'Próximo vencimiento · {{nombre_administracion}}',
  '<h2>Próximo vencimiento</h2><p>Hola {{nombre}}, te recordamos que el {{fecha_vencimiento}} vence tu cuenta por <strong>{{total}}</strong>. Podés abonar antes para evitar recargos.</p>',
  'Vencimiento el {{fecha_vencimiento}} por {{total}}.',
  'recupero', 'Recordatorio 30 días antes del vencimiento.',
  '["nombre","nombre_administracion","fecha_vencimiento","total"]'::jsonb),

 ('recordatorio-vencimiento-10d',
  'Recordatorio vencimiento 10 días',
  'Vence en 10 días · {{nombre_administracion}}',
  '<h2>Vencimiento próximo</h2><p>Hola {{nombre}}, tu cuenta vence el {{fecha_vencimiento}} por <strong>{{total}}</strong>. Si ya pagaste ignorá este mensaje.</p>',
  'Vencimiento el {{fecha_vencimiento}} por {{total}}.',
  'recupero', 'Recordatorio 10 días antes del vencimiento.',
  '["nombre","nombre_administracion","fecha_vencimiento","total"]'::jsonb),

 ('curso-inscripcion-confirmada',
  'Inscripción a curso confirmada',
  'Inscripción confirmada · {{nombre_curso}}',
  '<h2>¡Te inscribiste!</h2><p>Hola {{nombre}}, confirmamos tu inscripción al curso <strong>{{nombre_curso}}</strong> que arranca el {{fecha_inicio}}. En la fecha vas a recibir el link de acceso.</p>',
  'Inscripción al curso {{nombre_curso}} confirmada.',
  'cursos', 'Confirmación de inscripción a un curso del campus.',
  '["nombre","nombre_curso","fecha_inicio"]'::jsonb),

 ('formulario-submission-recibido',
  'Formulario recibido',
  'Recibimos tu formulario',
  '<h2>Gracias por escribirnos</h2><p>Hola {{nombre}}, recibimos tu mensaje. Un miembro del equipo te va a responder a la brevedad.</p>',
  'Gracias, recibimos tu mensaje.',
  'info', 'Acuse genérico para submissions de formularios públicos.',
  '["nombre"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- cron · dispatcher cada minuto. Si ya existe, no rompemos.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_url text := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-emails';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-emails-1min') THEN
    PERFORM cron.unschedule('dispatch-emails-1min');
  END IF;
  PERFORM cron.schedule(
    'dispatch-emails-1min',
    '*/1 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||current_setting('app.service_role_key', true)
        ),
        body := '{}'::jsonb
      );
    $cron$, v_url)
  );
EXCEPTION WHEN OTHERS THEN
  -- si current_setting no está seteado, dejamos el cron pero loggeamos.
  RAISE NOTICE 'cron schedule dispatch-emails-1min: %', SQLERRM;
END $$;
