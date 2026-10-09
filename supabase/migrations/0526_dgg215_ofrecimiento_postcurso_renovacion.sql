-- 0526_dgg215_ofrecimiento_postcurso_renovacion.sql
-- DGG-215 (pedido de Pablo): ofrecimiento con EFECTO INMEDIATO, event-driven,
-- INDEPENDIENTE del motor de ofrecimientos diario (que sigue en pausa / modo
-- sombra — NO se enciende ni se toca su lógica).
--
-- Qué hace: cuando un alumno descarga el certificado del Curso de Actualización
-- RPAC (PBA), se le ofrece por EMAIL + PUSH/campanita + BANNER que haga el
-- trámite de Renovación de matrícula con nosotros — SALVO que ya tenga un
-- trámite de renovación EN CURSO (pedido explícito de Pablo).
--
-- Decisiones de Pablo:
--   1) Sólo RPAC PBA (curso slug 'actualizacion2026-rpac', jurisdiccion 'pba').
--   2) Es un ofrecimiento AISLADO de la ocasión: usa un código propio
--      ('renovacion_postcurso') que NO colisiona ni suprime el ofrecimiento por
--      vencimiento ('renovacion_venc'). Ambas instancias (oportunidad + agenda)
--      conviven. Idempotencia: el hook dispara una sola vez por certificado
--      (primera descarga).
--   3) Copy aprobado (abajo).
--
-- GATE DE ENVÍOS REALES (DGG-199): arranca DETRÁS DE UN FLAG APAGADO
-- (config_global.ofrecimiento_postcurso_rpac_activo = false). No manda nada
-- hasta que Pablo lo prenda. Respeta además administraciones.ofrecimientos_habilitados.
--
-- Este archivo = "lado disparo". El banner en el portal va en 0527 (dashboard).

-- 1) Flag maestro (apagado por defecto)
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS ofrecimiento_postcurso_rpac_activo boolean NOT NULL DEFAULT false;

-- 2) Template de email post-curso (sólo var {{nombre}} → sin campos en blanco)
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, activo, variables,
   kicker, titulo_visual, cuerpo_html_visual, color_acento, mostrar_logo,
   incluir_tabla_envio, layout_version, cta_text, cta_url, firma, descripcion)
VALUES (
  'ofrecimiento-rpac-renovacion-postcurso',
  'Ofrecimiento · Renovación post-curso de actualización',
  '¡Terminaste el Curso de Actualización! ¿Renovamos tu matrícula? · Gestión Global',
  '<p>Hola {{nombre}}, felicitaciones por completar el Curso de Actualización. Ya tenés uno de los requisitos clave para renovar tu matrícula en el RPAC. Si querés, nos encargamos de todo el trámite por vos.</p>',
  'general', true, '["nombre"]'::jsonb,
  'RENOVACIÓN DE MATRÍCULA',
  'Terminaste tu Curso de Actualización, {{nombre}} 🎓',
  '<p style="margin:0 0 12px;color:#1e293b;">¡Felicitaciones, {{nombre}}! Completaste el <strong>Curso de Actualización</strong> 🎓. Ya tenés uno de los requisitos clave para renovar tu matrícula en el RPAC.</p><p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Si querés, nos encargamos de <strong>todo el trámite de renovación</strong> ante el RPAC: documentación, presentación y seguimiento hasta la constancia final.</p><p style="margin:0;color:#1e293b;">Es el mejor momento para dejar tu matrícula al día. Cualquier duda, respondé este correo.</p>',
  '#0891b2', true, false, 'manaxer-v1',
  'Solicitar renovación',
  'https://gestionglobal.ar/formulario/renovacion-rpac?origen=ofrecimiento',
  'Equipo Gestión Global',
  'DGG-215: ofrecimiento event-driven al descargar el certificado del Curso de Actualización RPAC (PBA). Gate flag config_global.ofrecimiento_postcurso_rpac_activo.'
)
ON CONFLICT (slug) DO NOTHING;

-- 3) Rama aditiva en el helper de toque (misma firma → sin overload, R16).
--    El motor diario NUNCA pasa 'renovacion_postcurso', así que su comportamiento
--    no cambia; sólo se agrega una rama reutilizable para el caller event-driven.
CREATE OR REPLACE FUNCTION public._gg_ofrecimiento_tocar(p_admin uuid, p_contacto text, p_email text, p_user uuid, p_codigo text, p_ancla date, p_titulo text DEFAULT NULL::text, p_form_url text DEFAULT NULL::text, p_fecha_detalle text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tpl text;
  v_asunto text;
  v_vars jsonb;
  v_push_titulo text;
  v_push_cuerpo text;
  v_push_url text;
  v_prox date;
BEGIN
  IF p_codigo = 'matriculacion' THEN
    v_tpl := 'ofrecimiento-matriculacion';
    v_push_titulo := 'Matriculate en el RPAC';
    v_push_cuerpo := 'Te ayudamos a gestionar tu matrícula de administrador.';
    v_push_url := '/formulario/matriculacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'ddjj_ciclo' THEN
    v_tpl := 'ofrecimiento-ddjj';
    v_push_titulo := 'Tu DDJJ anual vence en marzo';
    v_push_cuerpo := 'La preparamos y presentamos por vos. Arrancá hoy.';
    v_push_url := '/formulario/ddjj-anual?origen=ofrecimiento';
  ELSIF p_codigo IN ('curso_venc','curso_actualizacion_60') THEN
    v_tpl := 'ofrecimiento-curso-actualizacion-rpac';
    v_push_titulo := 'Curso de Actualización RPAC';
    v_push_cuerpo := 'Requisito anual para tu matrícula. Reservá tu lugar.';
    v_push_url := '/formulario/curso-actualizacion?origen=ofrecimiento';
  ELSIF p_codigo = 'renovacion_venc' THEN
    v_tpl := 'ofrecimiento-rpac-renovacion';
    v_prox := private.gg_admin_prox_venc_matricula(p_admin);
    v_push_titulo := 'Tu matrícula RPAC vence pronto';
    v_push_cuerpo := 'Renovala a tiempo. Lo gestionamos por vos.';
    v_push_url := '/formulario/renovacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'renovacion_postcurso' THEN
    -- DGG-215: disparo event-driven post-descarga del certificado de actualización.
    v_tpl := 'ofrecimiento-rpac-renovacion-postcurso';
    v_push_titulo := 'Curso completado 🎓';
    v_push_cuerpo := 'Ya podés renovar tu matrícula RPAC. Nos encargamos del trámite por vos.';
    v_push_url := '/formulario/renovacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'certificado_90' THEN
    v_tpl := 'ofrecimiento-rpac-certificado';
    v_push_titulo := 'Certificado de acreditación RPAC';
    v_push_cuerpo := 'Tu comprobante oficial de matrícula activa, en un click.';
    v_push_url := '/formulario/certificado-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'cj_120' THEN
    v_tpl := 'ofrecimiento-consultoria-juridica';
    v_push_titulo := 'Consultoría jurídica';
    v_push_cuerpo := '¿Dudas legales en tu administración? Estamos para ayudarte.';
    v_push_url := '/formulario/consultoria-juridica?origen=ofrecimiento';
  ELSE
    v_tpl := 'ofrecimiento-capacitacion-gratuita';
    v_push_titulo := 'Nueva capacitación gratuita';
    v_push_cuerpo := COALESCE(p_titulo, 'Inscribite sin costo — cupos limitados.');
    v_push_url := COALESCE(replace(p_form_url, 'https://gestionglobal.ar', ''), '/portal');
  END IF;

  v_vars := jsonb_build_object('nombre', p_contacto);
  IF p_titulo IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('titulo', p_titulo); END IF;
  IF p_form_url IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('form_url', p_form_url); END IF;
  IF p_fecha_detalle IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('fecha_detalle', p_fecha_detalle); END IF;
  IF p_codigo = 'renovacion_venc' AND v_prox IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object(
      'dias_restantes', GREATEST(0, (v_prox - p_ancla))::text,
      'fecha_vencimiento', to_char(v_prox, 'DD/MM/YYYY'));
  END IF;

  BEGIN
    IF p_email IS NULL OR trim(p_email) = '' THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'skipped', 'sin_email')
      ON CONFLICT DO NOTHING;
    ELSE
      SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_tpl AND activo;
      IF v_asunto IS NULL THEN
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', 'template_inexistente')
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.email_queue
          (kind, template_slug, to_email, to_nombre, variables, prioridad,
           programado_para, scheduled_at, administracion_id,
           related_table, related_id, subject, comprobante_ids, parte, partes_total)
        VALUES
          ('workflow', v_tpl, trim(p_email), p_contacto, v_vars, 7,
           now(), now(), p_admin, 'administraciones', p_admin, v_asunto, '{}', 1, 1);
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'ok')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', SQLERRM)
    ON CONFLICT DO NOTHING;
  END;

  BEGIN
    IF p_user IS NULL THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'skipped', 'sin_usuario_portal')
      ON CONFLICT DO NOTHING;
    ELSE
      PERFORM private.notif_emitir(p_user, 'ofrecimiento', v_push_titulo, v_push_cuerpo, v_push_url, '{}'::jsonb);
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'ok')
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'push', 'error', SQLERRM)
    ON CONFLICT DO NOTHING;
  END;

  INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
  VALUES (p_admin, p_codigo, p_ancla, 'banner', 'ok')
  ON CONFLICT DO NOTHING;
END;
$function$;

-- 4) Trigger fn: en la 1.ª descarga del cert de actualización RPAC PBA, dispara
--    el ofrecimiento de renovación por los 3 canales, con flag + gate.
CREATE OR REPLACE FUNCTION public.cert_descarga_ofrecimiento_postcurso_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin uuid := NEW.administracion_id;
  v_juris text;
  v_slug text;
  v_a record;
  v_contacto text;
  v_email text;
BEGIN
  -- Gate de envíos reales (DGG-199): nada hasta que Pablo prenda el flag.
  IF NOT COALESCE((SELECT ofrecimiento_postcurso_rpac_activo FROM public.config_global ORDER BY id LIMIT 1), false) THEN
    RETURN NEW;
  END IF;

  IF v_admin IS NULL THEN RETURN NEW; END IF;

  -- Sólo Curso de Actualización RPAC PBA (CABA es otro régimen → fuera).
  SELECT jurisdiccion, slug INTO v_juris, v_slug FROM public.cursos WHERE id = NEW.curso_id;
  IF v_juris IS DISTINCT FROM 'pba' OR COALESCE(v_slug,'') NOT ILIKE '%actualizacion%' THEN
    RETURN NEW;
  END IF;

  -- Admin elegible.
  SELECT id, nombre, email, user_id, responsable_nombre, responsable_apellido,
         activo, estado, ofrecimientos_habilitados
    INTO v_a
  FROM public.administraciones WHERE id = v_admin;
  IF NOT FOUND
     OR NOT COALESCE(v_a.ofrecimientos_habilitados, false)
     OR NOT COALESCE(v_a.activo, false)
     OR COALESCE(v_a.estado, '') = 'baja' THEN
    RETURN NEW;
  END IF;

  -- Gate de Pablo: no ofrecer si ya tiene una renovación EN CURSO.
  IF EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = v_admin
      AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ) THEN
    RETURN NEW;
  END IF;

  -- Contacto / email / usuario del portal.
  v_contacto := COALESCE(
    (SELECT NULLIF(trim(full_name), '') FROM public.profiles WHERE id = NEW.alumno_profile_id),
    NULLIF(trim(COALESCE(v_a.responsable_nombre,'') || ' ' || COALESCE(v_a.responsable_apellido,'')), ''),
    v_a.nombre, 'administrador/a');
  v_email := COALESCE(
    NULLIF(trim(COALESCE(v_a.email,'')), ''),
    (SELECT email FROM auth.users WHERE id = NEW.alumno_profile_id));

  -- Disparo event-driven (código propio: no suprime 'renovacion_venc').
  PERFORM public._gg_ofrecimiento_tocar(
    v_admin, v_contacto, v_email, COALESCE(v_a.user_id, NEW.alumno_profile_id),
    'renovacion_postcurso', public.hoy_ar());

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cert_descarga_ofrecimiento_postcurso ON public.certificados;
CREATE TRIGGER trg_cert_descarga_ofrecimiento_postcurso
AFTER UPDATE OF descargado_alumno_at ON public.certificados
FOR EACH ROW
WHEN (OLD.descargado_alumno_at IS NULL AND NEW.descargado_alumno_at IS NOT NULL)
EXECUTE FUNCTION public.cert_descarga_ofrecimiento_postcurso_fn();
