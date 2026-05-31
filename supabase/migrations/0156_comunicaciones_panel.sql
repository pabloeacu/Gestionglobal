-- ============================================================================
-- 0156_comunicaciones_panel · Sistema de Noticias / Novedades multi-canal
--
-- Permite a la gerencia enviar comunicaciones a clientes (administraciones)
-- por tres canales independientes o combinados:
--   1. Banner en dashboard portal cliente (siempre persiste hasta marcar vista
--      o hasta visible_hasta)
--   2. Email (encolar_email · template comunicacion-novedad)
--   3. Push web (encolar_push)
--
-- Filtrado de audiencia (audiencia jsonb):
--   - {"type":"todos"}                            → todas las admin activas
--   - {"type":"manual","administracion_ids":[…]}  → lista explícita
--   - {"type":"by_servicios","servicio_ids":[…]}  → admin con tracking en X
--   - {"type":"by_convenio","convenios":[…]}      → admin de convenio X
--
-- Reglas: 1, 2, 4, 5, 6, 8, 12, 13 cumplidas. RPC SECURITY DEFINER + tenancy
-- check (sólo staff envía; cualquier admin marca vista propia).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. comunicaciones · cabecera
-- ---------------------------------------------------------------------------
CREATE TABLE public.comunicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  titulo text NOT NULL,
  cuerpo_md text NOT NULL,
  cuerpo_html text,
  cta_label text,
  cta_url text,

  audiencia jsonb NOT NULL DEFAULT '{"type":"todos"}'::jsonb,

  canal_banner boolean NOT NULL DEFAULT true,
  canal_email boolean NOT NULL DEFAULT false,
  canal_push boolean NOT NULL DEFAULT false,

  banner_estilo text NOT NULL DEFAULT 'novedad'
    CHECK (banner_estilo IN ('info','novedad','aviso','urgente')),
  visible_desde timestamptz NOT NULL DEFAULT now(),
  visible_hasta timestamptz,

  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','enviado','archivado')),
  enviado_at timestamptz,
  enviado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_destinatarios int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT chk_comunicacion_algun_canal CHECK (
    canal_banner OR canal_email OR canal_push
  ),
  CONSTRAINT chk_comunicacion_visible_hasta CHECK (
    visible_hasta IS NULL OR visible_hasta > visible_desde
  )
);

ALTER TABLE public.comunicaciones ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comunicaciones TO authenticated;

CREATE INDEX idx_comunicaciones_estado_visible
  ON public.comunicaciones(estado, visible_desde, visible_hasta)
  WHERE estado = 'enviado';
CREATE INDEX idx_comunicaciones_created_by
  ON public.comunicaciones(created_by)
  WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_comunicaciones_touch
  BEFORE UPDATE ON public.comunicaciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sólo staff puede gestionar comunicaciones desde el panel
CREATE POLICY comunicaciones_staff_all
  ON public.comunicaciones FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

COMMENT ON TABLE public.comunicaciones IS
  'Noticias / novedades enviadas por gerencia a clientes (multi-canal).';

-- ---------------------------------------------------------------------------
-- 2. comunicaciones_destinatarios · materializado al enviar
-- ---------------------------------------------------------------------------
CREATE TABLE public.comunicaciones_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comunicacion_id uuid NOT NULL REFERENCES public.comunicaciones(id) ON DELETE CASCADE,
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email_to text,
  email_enqueued_at timestamptz,
  push_enqueued_at timestamptz,
  visto_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_comunicacion_admin UNIQUE (comunicacion_id, administracion_id)
);

ALTER TABLE public.comunicaciones_destinatarios ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comunicaciones_destinatarios TO authenticated;

CREATE INDEX idx_comdest_comunicacion
  ON public.comunicaciones_destinatarios(comunicacion_id);
CREATE INDEX idx_comdest_admin_no_visto
  ON public.comunicaciones_destinatarios(administracion_id)
  WHERE visto_at IS NULL;
CREATE INDEX idx_comdest_user
  ON public.comunicaciones_destinatarios(user_id)
  WHERE user_id IS NOT NULL;

-- Staff ve todo; cliente sólo ve filas que lo apunten (vía admin.user_id)
CREATE POLICY comdest_staff_all
  ON public.comunicaciones_destinatarios FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

CREATE POLICY comdest_cliente_select
  ON public.comunicaciones_destinatarios FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.administraciones a
      WHERE a.id = comunicaciones_destinatarios.administracion_id
        AND a.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.comunicaciones_destinatarios IS
  'Materialización de la audiencia al momento de enviar la comunicación; trackea visto y entregas por canal.';

-- ---------------------------------------------------------------------------
-- 3. Helper · resolver audiencia → set de administracion_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._comunicacion_resolver_audiencia(p_audiencia jsonb)
RETURNS TABLE(administracion_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  v_type := COALESCE(p_audiencia->>'type', 'todos');

  IF v_type = 'todos' THEN
    RETURN QUERY
      SELECT a.id FROM public.administraciones a
      WHERE a.estado = 'activo' AND a.activo = true;
  ELSIF v_type = 'manual' THEN
    RETURN QUERY
      SELECT a.id FROM public.administraciones a
      WHERE a.estado = 'activo' AND a.activo = true
        AND a.id::text IN (
          SELECT jsonb_array_elements_text(p_audiencia->'administracion_ids')
        );
  ELSIF v_type = 'by_servicios' THEN
    RETURN QUERY
      SELECT DISTINCT a.id FROM public.administraciones a
      JOIN public.tramites t ON t.administracion_id = a.id
      WHERE a.estado = 'activo' AND a.activo = true
        AND t.servicio_id::text IN (
          SELECT jsonb_array_elements_text(p_audiencia->'servicio_ids')
        );
  ELSIF v_type = 'by_convenio' THEN
    RETURN QUERY
      SELECT a.id FROM public.administraciones a
      WHERE a.estado = 'activo' AND a.activo = true
        AND a.convenio IN (
          SELECT jsonb_array_elements_text(p_audiencia->'convenios')
        );
  ELSE
    RAISE EXCEPTION 'audiencia.type desconocido: %', v_type;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public._comunicacion_resolver_audiencia(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._comunicacion_resolver_audiencia(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC · comunicacion_preview_destinatarios(audiencia)
--    Vista previa para gerencia antes de enviar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comunicacion_preview_destinatarios(p_audiencia jsonb)
RETURNS TABLE(
  administracion_id uuid,
  nombre text,
  email text,
  tiene_user boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.nombre, a.email, (a.user_id IS NOT NULL)
    FROM public.administraciones a
    WHERE a.id IN (
      SELECT r.administracion_id FROM public._comunicacion_resolver_audiencia(p_audiencia) r
    )
    ORDER BY a.nombre;
END $$;

REVOKE EXECUTE ON FUNCTION public.comunicacion_preview_destinatarios(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comunicacion_preview_destinatarios(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC · comunicacion_enviar(id)
--    Materializa destinatarios, encola emails y pushes según canales.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comunicacion_enviar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_com record;
  v_user_id uuid := auth.uid();
  v_total int := 0;
  v_emails int := 0;
  v_pushes int := 0;
  v_dest record;
  v_admin_user uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_com FROM public.comunicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'comunicacion no encontrada';
  END IF;
  IF v_com.estado = 'enviado' THEN
    RAISE EXCEPTION 'comunicacion ya enviada';
  END IF;

  -- Materializar destinatarios desde audiencia
  INSERT INTO public.comunicaciones_destinatarios
    (comunicacion_id, administracion_id, user_id, email_to)
  SELECT p_id, a.id, a.user_id, a.email
  FROM public.administraciones a
  WHERE a.id IN (
    SELECT r.administracion_id FROM public._comunicacion_resolver_audiencia(v_com.audiencia) r
  )
  ON CONFLICT (comunicacion_id, administracion_id) DO NOTHING;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  -- Encolar por canal
  FOR v_dest IN
    SELECT d.id, d.administracion_id, d.user_id, d.email_to, a.nombre AS admin_nombre
    FROM public.comunicaciones_destinatarios d
    JOIN public.administraciones a ON a.id = d.administracion_id
    WHERE d.comunicacion_id = p_id
  LOOP
    -- Email
    IF v_com.canal_email AND v_dest.email_to IS NOT NULL AND v_dest.email_to <> '' THEN
      PERFORM public.encolar_email(
        'comunicacion-novedad'::text,
        v_dest.email_to,
        v_dest.admin_nombre,
        jsonb_build_object(
          'nombre_administracion', v_dest.admin_nombre,
          'titulo', v_com.titulo,
          'cuerpo_html', COALESCE(v_com.cuerpo_html, replace(v_com.cuerpo_md, E'\n', '<br>')),
          'cta_label', v_com.cta_label,
          'cta_url', v_com.cta_url
        ),
        NULL::uuid,            -- p_administracion_id (no tenancy required)
        NULL::uuid,            -- p_consorcio_id
        'comunicaciones'::text,
        p_id,
        5::smallint
      );
      UPDATE public.comunicaciones_destinatarios
        SET email_enqueued_at = now()
        WHERE id = v_dest.id;
      v_emails := v_emails + 1;
    END IF;

    -- Push (sólo si el cliente tiene user_id vinculado)
    IF v_com.canal_push AND v_dest.user_id IS NOT NULL THEN
      PERFORM public.encolar_push(
        v_dest.user_id,
        v_com.titulo,
        left(v_com.cuerpo_md, 140),
        '/icons/icon-192.png',
        COALESCE(v_com.cta_url, '/portal')
      );
      UPDATE public.comunicaciones_destinatarios
        SET push_enqueued_at = now()
        WHERE id = v_dest.id;
      v_pushes := v_pushes + 1;
    END IF;
  END LOOP;

  -- Marcar enviado
  UPDATE public.comunicaciones SET
    estado = 'enviado',
    enviado_at = now(),
    enviado_por = v_user_id,
    total_destinatarios = v_total
  WHERE id = p_id;

  RETURN jsonb_build_object(
    'comunicacion_id', p_id,
    'destinatarios', v_total,
    'emails_encolados', v_emails,
    'pushes_encolados', v_pushes
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.comunicacion_enviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comunicacion_enviar(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC · comunicacion_marcar_vista(id)
--    El administrador cliente marca como leído desde el banner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comunicacion_marcar_vista(p_comunicacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  UPDATE public.comunicaciones_destinatarios d
  SET visto_at = COALESCE(d.visto_at, now())
  WHERE d.comunicacion_id = p_comunicacion_id
    AND (d.user_id = v_uid OR EXISTS (
      SELECT 1 FROM public.administraciones a
      WHERE a.id = d.administracion_id AND a.user_id = v_uid
    ));
END $$;

REVOKE EXECUTE ON FUNCTION public.comunicacion_marcar_vista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comunicacion_marcar_vista(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC · comunicaciones_vigentes_cliente()
--    Listado para el dashboard del portal cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comunicaciones_vigentes_cliente()
RETURNS TABLE(
  id uuid,
  titulo text,
  cuerpo_md text,
  cta_label text,
  cta_url text,
  banner_estilo text,
  enviado_at timestamptz,
  visto_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      c.id, c.titulo, c.cuerpo_md, c.cta_label, c.cta_url,
      c.banner_estilo, c.enviado_at, d.visto_at
    FROM public.comunicaciones c
    JOIN public.comunicaciones_destinatarios d ON d.comunicacion_id = c.id
    JOIN public.administraciones a ON a.id = d.administracion_id
    WHERE c.estado = 'enviado'
      AND c.canal_banner = true
      AND c.visible_desde <= now()
      AND (c.visible_hasta IS NULL OR c.visible_hasta > now())
      AND a.user_id = v_uid
    ORDER BY c.enviado_at DESC;
END $$;

REVOKE EXECUTE ON FUNCTION public.comunicaciones_vigentes_cliente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comunicaciones_vigentes_cliente() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Email template seed · comunicacion-novedad
-- (usa la estructura visual manaxer-v1: kicker / titulo_visual / cuerpo_html_visual)
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates (
  slug, nombre, asunto,
  body_html, body_text,
  from_casilla, activo, variables,
  kicker, titulo_visual, color_acento, mostrar_logo,
  cuerpo_html_visual, firma, incluir_tabla_envio,
  cta_text, cta_url, layout_version,
  descripcion
)
VALUES (
  'comunicacion-novedad',
  'Novedad / Noticia (panel comunicaciones)',
  '{{titulo}} · Gestión Global',
  -- body_html (legacy) — el renderer real arma a partir de cuerpo_html_visual
  $tpl$<p>{{cuerpo_html}}</p>$tpl$,
  '{{titulo}}',
  'general',
  true,
  '{"titulo":"Título de la novedad","cuerpo_html":"Texto en HTML","cta_label":"Texto del botón","cta_url":"URL del CTA","nombre_administracion":"Razón social del cliente"}'::jsonb,
  'NOVEDAD',
  '{{titulo}}',
  '#0891b2',
  true,
  $cuerpo$
<p>Hola <strong>{{nombre_administracion}}</strong>,</p>
<p>{{cuerpo_html}}</p>
  $cuerpo$,
  'Equipo Gestión Global',
  false,
  '{{cta_label}}',
  '{{cta_url}}',
  'manaxer-v1',
  'Plantilla del panel de Comunicaciones (noticias/novedades enviadas por gerencia).'
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  asunto = EXCLUDED.asunto,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  from_casilla = EXCLUDED.from_casilla,
  activo = EXCLUDED.activo,
  variables = EXCLUDED.variables,
  kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual,
  color_acento = EXCLUDED.color_acento,
  mostrar_logo = EXCLUDED.mostrar_logo,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  firma = EXCLUDED.firma,
  incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url,
  layout_version = EXCLUDED.layout_version,
  descripcion = EXCLUDED.descripcion;
