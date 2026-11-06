-- 0657 · DGG-244 F2d-A · Suscripción pública a LexPH (doble opt-in) + confirm/baja.
--
-- Pablo eligió "suscripción pública en /lexph". Camino bien hecho:
--   · alta pública anon → estado 'pendiente' + email de CONFIRMACIÓN (doble opt-in);
--   · confirmar (token) → 'confirmado'; baja (token) → 'baja'. Tokens uuid v4 (122 bits).
-- NO toca el edge money-crítico `dispatch-emails` (gate R7): reusa la cola template-based
-- (kind='workflow' + template_slug + variables) y una plantilla manaxer net-new.
-- El ENVÍO del newsletter (F2d-B) es un paso aparte (decisión de formato pendiente de Pablo).
--
-- Reglas: R2 (RLS), R5 (RPC SECDEF multi-tabla: suscriptor + cola), R6 (grants), R11 (índices).

-- ============================================================================
-- 1. Tabla de suscriptores — staff lee; anon sólo vía RPCs SECDEF (sin grant de tabla)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lexph_suscriptores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  email_norm    text NOT NULL,                        -- lower(btrim) para unicidad
  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado','baja')),
  confirm_token uuid NOT NULL DEFAULT gen_random_uuid(),
  baja_token    uuid NOT NULL DEFAULT gen_random_uuid(),
  origen        text NOT NULL DEFAULT 'web_lexph',
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,
  baja_at       timestamptz,
  last_email_at timestamptz                           -- cooldown anti-abuso del reenvío
);
COMMENT ON TABLE public.lexph_suscriptores IS
  'DGG-244 F2d · Suscriptores del newsletter LexPH (doble opt-in). Alta anon vía RPC; staff lee.';

ALTER TABLE public.lexph_suscriptores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lexph_suscriptores FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lexph_suscriptores TO authenticated;  -- RLS limita a staff
CREATE POLICY lexph_suscriptores_staff_all ON public.lexph_suscriptores
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

CREATE UNIQUE INDEX IF NOT EXISTS idx_lexph_susc_email ON public.lexph_suscriptores (email_norm);
CREATE INDEX IF NOT EXISTS idx_lexph_susc_estado ON public.lexph_suscriptores (estado);
CREATE INDEX IF NOT EXISTS idx_lexph_susc_confirm ON public.lexph_suscriptores (confirm_token);
CREATE INDEX IF NOT EXISTS idx_lexph_susc_baja ON public.lexph_suscriptores (baja_token);

-- ============================================================================
-- 2. Plantilla de confirmación (manaxer-v1, casilla jurídica) — net-new, idempotente
-- ============================================================================
INSERT INTO public.email_templates
  (slug, nombre, asunto, from_casilla, reply_to, activo, layout_version, color_acento, mostrar_logo,
   kicker, titulo_visual, cuerpo_html_visual, cta_text, cta_url, body_html, body_text, descripcion)
VALUES
  -- from_casilla='general' (contacto@): buzón principal verificado (send-as). 'juridico'
  -- (consultoriajuridica@) daría aislamiento de reputación pero NO está verificado como
  -- send-as en Workspace (ningún template lo usa) → el remitente dedicado para blasts queda
  -- flaggeado para Pablo (setup de send-as + SPF/DKIM). La confirmación es transaccional.
  ('lexph-confirmar-suscripcion', 'LexPH · Confirmar suscripción',
   'Confirmá tu suscripción a LexPH', 'general', NULL, true, 'manaxer-v1', '#009ECA', true,
   'LexPH · Un servicio de Gestión Global',
   'Confirmá tu suscripción',
   '<p style="margin:0 0 14px;">Recibimos tu pedido para sumarte a <strong>LexPH</strong>: novedades jurídicas de propiedad horizontal —fallos, normativas e insights— explicadas para administrar mejor.</p>'
   '<p style="margin:0 0 14px;">Confirmá tu correo con el botón de abajo. Si no fuiste vos, ignorá este mensaje y no te suscribiremos.</p>',
   'Confirmar mi suscripción', '{{confirm_url}}',
   -- body_html = fallback legacy (NOT NULL); manaxer-v1 usa cuerpo_html_visual, esto sólo si queda vacío.
   '<!doctype html><html lang="es"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#122230;padding:24px;"><p>Confirmá tu suscripción a <strong>LexPH</strong> (novedades jurídicas de propiedad horizontal).</p><p><a href="{{confirm_url}}" style="color:#009ECA;">Confirmar mi suscripción</a></p><p style="font-size:12px;color:#8aa;">Si no fuiste vos, ignorá este mensaje. Gestión Global · gestionglobal.ar</p></body></html>',
   'Confirmá tu suscripción a LexPH abriendo este enlace: {{confirm_url}} — Si no fuiste vos, ignorá este mensaje.',
   'DGG-244 F2d · confirmación de suscripción (doble opt-in) a LexPH.')
ON CONFLICT (slug) DO UPDATE SET
   asunto = EXCLUDED.asunto, from_casilla = EXCLUDED.from_casilla, activo = EXCLUDED.activo,
   layout_version = EXCLUDED.layout_version, color_acento = EXCLUDED.color_acento,
   mostrar_logo = EXCLUDED.mostrar_logo, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
   cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text, cta_url = EXCLUDED.cta_url,
   body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, updated_at = now();

-- ============================================================================
-- 3. Alta pública (anon) — doble opt-in: upsert pendiente + email de confirmación
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_suscribir(p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm    text := lower(btrim(coalesce(p_email, '')));
  v_id      uuid;
  v_estado  text;
  v_last    timestamptz;
  v_confirm uuid;
  v_baja    uuid;
  v_email   text;
  v_enqueue boolean := false;
BEGIN
  -- Validación de formato (básica; la verdad la da el doble opt-in).
  IF v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(v_norm) > 254 THEN
    RAISE EXCEPTION 'Email inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT id, estado, last_email_at, confirm_token, baja_token, email
    INTO v_id, v_estado, v_last, v_confirm, v_baja, v_email
  FROM public.lexph_suscriptores WHERE email_norm = v_norm;

  IF v_id IS NULL THEN
    INSERT INTO public.lexph_suscriptores (email, email_norm, estado)
    VALUES (btrim(p_email), v_norm, 'pendiente')
    RETURNING id, confirm_token, baja_token, email INTO v_id, v_confirm, v_baja, v_email;
    v_enqueue := true;
  ELSIF v_estado = 'confirmado' THEN
    v_enqueue := false;                           -- idempotente: no reenvía ni filtra info
  ELSIF v_estado = 'baja' THEN                     -- re-alta explícita tras baja → confirmación fresca
    UPDATE public.lexph_suscriptores
      SET estado = 'pendiente', baja_at = NULL, confirm_token = gen_random_uuid()
      WHERE id = v_id
      RETURNING confirm_token INTO v_confirm;
    v_enqueue := true;
  ELSE                                             -- pendiente: cooldown anti-abuso (no reenviar < 10 min)
    IF v_last IS NULL OR v_last < now() - interval '10 minutes' THEN
      v_enqueue := true;
    END IF;
  END IF;

  IF v_enqueue THEN
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    VALUES
      ('workflow', 'lexph-confirmar-suscripcion', v_email,
       jsonb_build_object(
         'confirm_url', 'https://www.gestionglobal.ar/lexph/confirmar?token=' || v_confirm,
         'baja_url',    'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
       5, 'lexph_suscriptores', v_id, now());
    UPDATE public.lexph_suscriptores SET last_email_at = now() WHERE id = v_id;
  END IF;

  -- Respuesta genérica (sin enumeración de direcciones existentes).
  RETURN jsonb_build_object('ok', true);
END;
$$;
COMMENT ON FUNCTION public.lexph_suscribir IS
  'DGG-244 F2d · Alta pública (doble opt-in) a LexPH: upsert pendiente + encola confirmación. Respuesta genérica.';
REVOKE ALL ON FUNCTION public.lexph_suscribir(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_suscribir(text) TO anon, authenticated;

-- ============================================================================
-- 4. Confirmar (anon, por token) — pendiente → confirmado
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_suscripcion_confirmar(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_estado text;
BEGIN
  SELECT id, estado INTO v_id, v_estado
  FROM public.lexph_suscriptores WHERE confirm_token = p_token;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'estado', 'invalido');
  END IF;
  IF v_estado = 'confirmado' THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'confirmado');
  END IF;

  UPDATE public.lexph_suscriptores
     SET estado = 'confirmado', confirmed_at = COALESCE(confirmed_at, now()), baja_at = NULL
   WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'estado', 'confirmado');
END;
$$;
REVOKE ALL ON FUNCTION public.lexph_suscripcion_confirmar(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_suscripcion_confirmar(uuid) TO anon, authenticated;

-- ============================================================================
-- 5. Baja (anon, por token) — one-click opt-out
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_suscripcion_baja(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.lexph_suscriptores WHERE baja_token = p_token;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'estado', 'invalido');
  END IF;
  UPDATE public.lexph_suscriptores
     SET estado = 'baja', baja_at = now()
   WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'estado', 'baja');
END;
$$;
REVOKE ALL ON FUNCTION public.lexph_suscripcion_baja(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_suscripcion_baja(uuid) TO anon, authenticated;
