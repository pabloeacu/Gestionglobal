-- ============================================================================
-- 0157_webinars_g1_g2 · Subsistema comercial webinars + wrapper Campus
--
-- G1 (DGG-11): segmentación cliente vs prospecto en envíos + histórico de
-- inscripciones por administración (capitaliza la info del webinar como
-- registro de fidelización / conversión sin tocar el modelo fiscal de CC).
--
-- G2 (DGG-15): el magic-link del webinar ahora apunta a un wrapper premium
-- dentro del Campus (`/campus/webinar/:token`) — el prospecto entra al mismo
-- shell que un alumno matriculado, pero sólo ve ese webinar.
--
-- Cambios:
--   1. webinar_email_vars: agrega es_cliente, es_prospecto, link_acceso_campus.
--   2. Templates separadas (cliente vs prospecto) para bienvenida + recordatorios.
--   3. Trigger tg_webinar_token_bienvenida elige template según contexto.
--   4. Cron de recordatorios usa el slug correcto según contexto.
--   5. Vista vw_administracion_webinars: histórico por administración.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper extendido: webinar_email_vars con flags + link_acceso_campus
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.webinar_email_vars(
  p_inscripto_id uuid,
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ins record;
  v_web record;
  v_base_url text;
  v_canal_human text;
  v_fecha_human text;
  v_es_cliente boolean;
  v_es_prospecto boolean;
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = p_inscripto_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = v_ins.webinar_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT COALESCE(NULLIF(sitio_web, ''), 'https://gestionglobal.ar')
    INTO v_base_url
    FROM public.config_global LIMIT 1;
  IF v_base_url IS NULL THEN v_base_url := 'https://gestionglobal.ar'; END IF;

  v_canal_human := CASE WHEN v_ins.canal = 'zoom' THEN 'Zoom (con asistencia automática)' ELSE 'YouTube Live' END;
  v_fecha_human := to_char(v_web.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'TMDay DD "de" TMMonth, HH24:MI "hs"');

  v_es_cliente := v_ins.administracion_id IS NOT NULL;
  v_es_prospecto := v_ins.prospecto_id IS NOT NULL;

  RETURN jsonb_build_object(
    'nombre', v_ins.nombre_snapshot,
    'webinar_titulo', v_web.titulo,
    'webinar_descripcion', COALESCE(v_web.descripcion, ''),
    'fecha_hora', v_web.fecha_hora,
    'fecha_humana', v_fecha_human,
    'duracion_min', v_web.duracion_min,
    'canal', v_ins.canal,
    'canal_humano', v_canal_human,
    -- G2 · el link ahora apunta al wrapper Campus.
    'link_acceso', v_base_url || '/campus/webinar/' || p_token,
    'link_acceso_directo', v_base_url || '/webinar/' || p_token,
    -- G1 · contexto para templates segmentadas.
    'es_cliente', v_es_cliente,
    'es_prospecto', v_es_prospecto
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION private.webinar_email_vars(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Templates segmentadas: bienvenida + recordatorios para clientes y prospectos
-- ---------------------------------------------------------------------------

-- A) BIENVENIDA · CLIENTE (sin CTA "Conocé Gestión Global", sin promo conversion)
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html, body_text, from_casilla, activo, variables,
  kicker, titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual,
  firma, incluir_tabla_envio, cta_text, cta_url, layout_version, descripcion
) VALUES (
  'webinar-bienvenida-cliente',
  'Webinar · Bienvenida (cliente activo)',
  'Te inscribiste a {{webinar_titulo}} · Gestión Global',
  E'<p>{{webinar_descripcion}}</p>',
  '{{webinar_titulo}} — {{fecha_humana}}',
  'webinar', true,
  '{"nombre":"María","webinar_titulo":"Webinar tal","webinar_descripcion":"Texto","fecha_humana":"viernes 30 de mayo, 19:00 hs","duracion_min":60,"canal_humano":"Zoom (con asistencia automática)","link_acceso":"https://..."}'::jsonb,
  'INSCRIPCIÓN CONFIRMADA',
  '{{webinar_titulo}}',
  '#0891b2', true,
  E'<p>Hola <strong>{{nombre}}</strong>,</p>\n<p>Confirmamos tu inscripción al webinar.</p>\n<p><strong>{{fecha_humana}}</strong> · {{duracion_min}} min · {{canal_humano}}</p>\n<p>{{webinar_descripcion}}</p>\n<p>Como cliente activo de Gestión Global, ya tenés acceso al Campus. El link de abajo te lleva directo al webinar sin pedir contraseña.</p>',
  'Equipo Gestión Global',
  false,
  'Entrar al webinar',
  '{{link_acceso}}',
  'manaxer-v1',
  'Bienvenida al inscribirse a un webinar — versión para clientes activos (sin pitch de conversión).'
) ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre, asunto = EXCLUDED.asunto, body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text, from_casilla = EXCLUDED.from_casilla, activo = EXCLUDED.activo,
  variables = EXCLUDED.variables, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  color_acento = EXCLUDED.color_acento, mostrar_logo = EXCLUDED.mostrar_logo,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, firma = EXCLUDED.firma,
  incluir_tabla_envio = EXCLUDED.incluir_tabla_envio, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version,
  descripcion = EXCLUDED.descripcion;

-- B) BIENVENIDA · PROSPECTO (con CTA "Conocé Gestión Global")
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html, body_text, from_casilla, activo, variables,
  kicker, titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual,
  firma, incluir_tabla_envio, cta_text, cta_url, layout_version, descripcion
) VALUES (
  'webinar-bienvenida-prospecto',
  'Webinar · Bienvenida (prospecto / no-cliente)',
  'Te inscribiste a {{webinar_titulo}} · Gestión Global',
  E'<p>{{webinar_descripcion}}</p>',
  '{{webinar_titulo}} — {{fecha_humana}}',
  'webinar', true,
  '{"nombre":"María","webinar_titulo":"Webinar tal","webinar_descripcion":"Texto","fecha_humana":"viernes 30 de mayo, 19:00 hs","duracion_min":60,"canal_humano":"Zoom (con asistencia automática)","link_acceso":"https://..."}'::jsonb,
  'INSCRIPCIÓN CONFIRMADA',
  '{{webinar_titulo}}',
  '#0891b2', true,
  E'<p>Hola <strong>{{nombre}}</strong>,</p>\n<p>Confirmamos tu inscripción.</p>\n<p><strong>{{fecha_humana}}</strong> · {{duracion_min}} min · {{canal_humano}}</p>\n<p>{{webinar_descripcion}}</p>\n<p>El link de abajo te lleva al webinar sin contraseña.</p>\n<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">\n<p style="font-size:13px;color:#475569;"><strong>¿Conocés Gestión Global?</strong> Somos un ecosistema digital para administradores de consorcios: matrículas, trámites, cuenta corriente, agenda y campus, todo en un solo lugar. <a href="https://gestionglobal.ar" style="color:#0891b2;">Conocé los servicios →</a></p>',
  'Equipo Gestión Global',
  false,
  'Entrar al webinar',
  '{{link_acceso}}',
  'manaxer-v1',
  'Bienvenida al inscribirse a un webinar — versión para prospectos (incluye pitch de conversión).'
) ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre, asunto = EXCLUDED.asunto, body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text, from_casilla = EXCLUDED.from_casilla, activo = EXCLUDED.activo,
  variables = EXCLUDED.variables, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  color_acento = EXCLUDED.color_acento, mostrar_logo = EXCLUDED.mostrar_logo,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, firma = EXCLUDED.firma,
  incluir_tabla_envio = EXCLUDED.incluir_tabla_envio, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version,
  descripcion = EXCLUDED.descripcion;

-- ---------------------------------------------------------------------------
-- 3) Trigger actualizado: elige template según es_cliente vs es_prospecto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_webinar_token_bienvenida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ins record;
  v_vars jsonb;
  v_template text;
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = NEW.webinar_inscripto_id;
  IF NOT FOUND OR v_ins.bienvenida_email_enviada_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_vars := private.webinar_email_vars(NEW.webinar_inscripto_id, NEW.token);
  IF v_vars = '{}'::jsonb THEN RETURN NEW; END IF;

  -- G1 · segmentación cliente vs prospecto.
  v_template := CASE
    WHEN v_ins.administracion_id IS NOT NULL THEN 'webinar-bienvenida-cliente'
    WHEN v_ins.prospecto_id IS NOT NULL THEN 'webinar-bienvenida-prospecto'
    ELSE 'webinar-bienvenida'  -- legacy fallback
  END;

  BEGIN
    PERFORM public.encolar_email(
      v_template,
      v_ins.email_snapshot,
      v_ins.nombre_snapshot,
      v_vars,
      v_ins.administracion_id, NULL,
      'webinar_inscriptos', NEW.webinar_inscripto_id,
      3::smallint
    );
    UPDATE public.webinar_inscriptos
       SET bienvenida_email_enviada_at = now()
     WHERE id = NEW.webinar_inscripto_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_webinar_token_bienvenida: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_webinar_token_bienvenida() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Vista vw_administracion_webinars · histórico de inscripciones por admin
--    Sirve como "registro de servicios sin cargo" sin tocar el modelo fiscal.
--    Usada por la ficha del cliente (gerencia) y el portal del cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_administracion_webinars AS
SELECT
  ins.id AS inscripto_id,
  ins.administracion_id,
  w.id AS webinar_id,
  w.titulo,
  w.fecha_hora,
  w.duracion_min,
  w.status AS webinar_status,
  w.grabacion_url,
  ins.canal,
  ins.asistio,
  ins.tiempo_conectado_seg,
  ins.inscripto_at,
  ins.joined_at,
  ins.left_at
FROM public.webinar_inscriptos ins
JOIN public.webinars w ON w.id = ins.webinar_id
WHERE ins.administracion_id IS NOT NULL;

COMMENT ON VIEW public.vw_administracion_webinars IS
  'Histórico de inscripciones a webinars por administración. G1: capitaliza el dato sin crear líneas $0 en el modelo fiscal de CC.';

GRANT SELECT ON public.vw_administracion_webinars TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC · listar webinars históricos de una administración (gerencia + portal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.administracion_webinars(p_administracion_id uuid)
RETURNS TABLE(
  inscripto_id uuid,
  webinar_id uuid,
  titulo text,
  fecha_hora timestamptz,
  duracion_min int,
  webinar_status text,
  grabacion_url text,
  canal text,
  asistio boolean,
  tiempo_conectado_seg int,
  inscripto_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  -- Staff: cualquier admin. Cliente: sólo la suya (assert_administracion_access regla 12).
  IF NOT private.is_staff() THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
    SELECT v.inscripto_id, v.webinar_id, v.titulo, v.fecha_hora, v.duracion_min,
           v.webinar_status, v.grabacion_url, v.canal, v.asistio,
           v.tiempo_conectado_seg, v.inscripto_at
    FROM public.vw_administracion_webinars v
    WHERE v.administracion_id = p_administracion_id
    ORDER BY v.fecha_hora DESC;
END $$;

REVOKE EXECUTE ON FUNCTION public.administracion_webinars(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.administracion_webinars(uuid) TO authenticated;
