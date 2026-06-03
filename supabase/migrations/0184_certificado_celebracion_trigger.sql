-- ============================================================================
-- 0184 · DGG-41 · Trigger celebratorio AFTER INSERT en certificados
--
-- José Luis (2026-06-02): el cierre de un trámite curso por aprobación
-- es un MOMENTO IMPORTANTE. Hoy se cierra silenciosamente. Hay que
-- hacer un evento: banner en portal + push + email premium con
-- felicitaciones y CTA descarga.
--
-- Disparador: AFTER INSERT en `certificados`. Se dispara para CUALQUIER
-- cert emitido (vía cert auto del Campus, manual de gerencia, etc.).
-- ============================================================================

ALTER TABLE public.certificados
  ADD COLUMN IF NOT EXISTS celebracion_vista_at timestamptz NULL;

COMMENT ON COLUMN public.certificados.celebracion_vista_at IS
  'DGG-41 (2026-06-02): timestamp cuando el alumno descartó o descargó '
  'el banner celebratorio del portal. NULL = sigue mostrándose.';

-- Template email premium con frase fija de José Luis
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html, body_text,
  from_casilla, reply_to,
  descripcion, activo, variables,
  kicker, titulo_visual, color_acento, mostrar_logo,
  cuerpo_html_visual, firma, incluir_tabla_envio,
  cta_text, cta_url, layout_version
) VALUES (
  'curso-felicitacion',
  'Curso · Felicitaciones por completar',
  '🎓 ¡Felicitaciones, {{nombre}}! Terminaste {{curso_titulo}}',
  '<p>Hola {{nombre}}, terminaste el curso <strong>{{curso_titulo}}</strong> con éxito. Descargá tu certificado desde el portal.</p>',
  'Hola {{nombre}}, terminaste el curso {{curso_titulo}} con éxito. Descargá tu certificado desde {{link_portal}}',
  'cursos',
  'contacto@gestionglobal.ar',
  'Email celebratorio enviado automáticamente cuando se emite un cert. DGG-41.',
  true,
  '[{"key":"nombre","desc":"Nombre del alumno"},{"key":"curso_titulo","desc":"Título del curso aprobado"},{"key":"link_portal","desc":"URL al portal con la card de Mis cursos"},{"key":"link_verificacion","desc":"URL pública /verificar/:codigo"}]'::jsonb,
  'CAMPUS · LOGRO ALCANZADO',
  '🎓 ¡Felicitaciones, {{nombre}}!',
  '#f59e0b',
  true,
  '<div style="text-align:center;padding:24px 16px 0;"><p style="font-size:18px;line-height:1.6;color:#0f172a;margin:0 0 24px 0;">Terminaste el curso<br><strong style="font-size:22px;color:#0e7490;">{{curso_titulo}}</strong></p><div style="border-left:4px solid #f59e0b;background:#fef3c7;padding:18px 24px;margin:24px 0;border-radius:8px;text-align:left;"><p style="font-size:16px;line-height:1.7;color:#78350f;margin:0;font-style:italic;">Sin lugar a dudas, tu esfuerzo valió la pena.<br>Recordá: <strong>el éxito no se basa en encajar, sino en sobresalir</strong>.</p></div><p style="font-size:15px;color:#475569;margin:0 0 8px 0;">Tu certificado ya está disponible. Descargalo cuando quieras desde tu portal.</p></div>',
  '<p style="margin:0;color:#64748b;font-size:13px;">El equipo de Gestión Global</p>',
  false,
  '🎓 Descargar mi certificado',
  '{{link_portal}}',
  'manaxer-v1'
) ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url,
  titulo_visual = EXCLUDED.titulo_visual,
  kicker = EXCLUDED.kicker,
  color_acento = EXCLUDED.color_acento,
  from_casilla = EXCLUDED.from_casilla,
  updated_at = now();

-- Trigger celebratorio (SECURITY DEFINER + EXCEPTION para no abortar emisión)
CREATE OR REPLACE FUNCTION public.trg_certificado_celebrar_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_alumno_email   text;
  v_alumno_nombre  text;
  v_curso_titulo   text;
  v_link_portal    text := 'https://gestionglobal.ar/portal/mis-cursos';
  v_link_verif     text;
BEGIN
  SELECT au.email, COALESCE(p.full_name, 'Alumno')
    INTO v_alumno_email, v_alumno_nombre
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.id = NEW.alumno_profile_id;

  IF v_alumno_email IS NULL THEN
    RAISE WARNING 'trg_certificado_celebrar: alumno_profile_id=% sin email', NEW.alumno_profile_id;
    RETURN NEW;
  END IF;

  SELECT titulo INTO v_curso_titulo FROM public.cursos WHERE id = NEW.curso_id;
  IF v_curso_titulo IS NULL THEN v_curso_titulo := 'el curso'; END IF;

  v_link_verif := 'https://gestionglobal.ar/verificar/' || NEW.codigo;

  -- (a) Push notification
  BEGIN
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (
      NEW.alumno_profile_id,
      '🎓 ¡Felicitaciones!',
      'Terminaste ' || v_curso_titulo || '. Tu certificado está listo para descargar.',
      v_link_portal
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_certificado_celebrar push fallo: %', SQLERRM;
  END;

  -- (b) Email premium
  BEGIN
    PERFORM public.encolar_email(
      'curso-felicitacion',
      v_alumno_email,
      v_alumno_nombre,
      jsonb_build_object(
        'nombre',            v_alumno_nombre,
        'curso_titulo',      v_curso_titulo,
        'link_portal',       v_link_portal,
        'link_verificacion', v_link_verif
      ),
      NEW.administracion_id,
      NULL,
      'certificados',
      NEW.id,
      1::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_certificado_celebrar email fallo: %', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_certificado_celebrar fallo top-level: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_certificado_celebrar ON public.certificados;
CREATE TRIGGER trg_certificado_celebrar
AFTER INSERT ON public.certificados
FOR EACH ROW EXECUTE FUNCTION public.trg_certificado_celebrar_fn();

-- RPC: alumno marca el banner como visto/descargado
CREATE OR REPLACE FUNCTION public.cert_marcar_celebracion_vista(p_cert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_alumno uuid;
BEGIN
  SELECT alumno_profile_id INTO v_alumno FROM public.certificados WHERE id = p_cert_id;
  IF v_alumno IS NULL THEN RAISE EXCEPTION 'Certificado no encontrado' USING ERRCODE='P0002'; END IF;
  IF NOT (auth.uid() = v_alumno OR private.is_staff()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE public.certificados SET celebracion_vista_at = now()
   WHERE id = p_cert_id AND celebracion_vista_at IS NULL;
END;
$$;

-- RPC: lista certs sin ver del alumno logueado (para banner portal)
CREATE OR REPLACE FUNCTION public.cliente_certs_celebrar()
RETURNS TABLE (
  cert_id uuid, codigo text, curso_id uuid, curso_titulo text,
  emitido_at timestamptz, link_verificacion text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.codigo, c.curso_id, cu.titulo, c.emitido_at,
           'https://gestionglobal.ar/verificar/' || c.codigo
    FROM public.certificados c
    JOIN public.cursos cu ON cu.id = c.curso_id
    WHERE c.alumno_profile_id = auth.uid()
      AND c.celebracion_vista_at IS NULL
      AND c.revocado_at IS NULL
    ORDER BY c.emitido_at DESC;
END;
$$;
