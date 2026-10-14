-- 0573 · DGG-224 Fase 1 — El motor de ofrecimientos a CLIENTES respeta la
-- lista global de supresión (email_suppression).
--
-- Hueco detectado (auditoría de la baja de captación, 2026-10-14): el flujo de
-- baja de prospectos funciona y registra en email_suppression, pero el motor de
-- marketing a clientes (gg_ofrecimientos_diario → _gg_ofrecimiento_tocar) NUNCA
-- consultaba esa lista. Dos casos que muerden: (1) un prospecto que se dio de
-- baja y luego se vuelve cliente seguiría recibiendo marketing; (2) un email de
-- cliente que rebotó (suprimido por el harvester) seguiría recibiendo ofertas
-- → re-envío a casilla muerta = daño de reputación.
--
-- Fix quirúrgico y ESTRICTAMENTE aditivo/subtractivo: en el ÚNICO choke point
-- por donde pasan todos los toques (`_gg_ofrecimiento_tocar`, llamado por las
-- dos ramas del motor), se gatea el CANAL EMAIL: si el email está suprimido, se
-- registra el toque como skipped/'suprimido' en ofrecimientos_log y NO se encola.
-- Solo puede EXCLUIR destinatarios, nunca agregar. Push/banner (canales con su
-- propio control) no se tocan: la supresión es, por naturaleza, una lista de
-- EMAIL (el link dice "¿No querés recibir estos correos?").
-- Misma firma → CREATE OR REPLACE sin overload (R16 OK).

CREATE OR REPLACE FUNCTION public._gg_ofrecimiento_tocar(p_admin uuid, p_contacto text, p_email text, p_user uuid, p_codigo text, p_ancla date, p_titulo text DEFAULT NULL::text, p_form_url text DEFAULT NULL::text, p_fecha_detalle text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tpl text; v_asunto text; v_vars jsonb;
  v_push_titulo text; v_push_cuerpo text; v_push_url text;
  v_prox date; v_fv date;
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
    v_tpl := 'ofrecimiento-rpac-renovacion-postcurso';
    v_push_titulo := 'Curso completado 🎓';
    v_push_cuerpo := 'Ya podés renovar tu matrícula RPAC. Nos encargamos del trámite por vos.';
    v_push_url := '/formulario/renovacion-rpac?origen=ofrecimiento';
  ELSIF p_codigo = 'matricula_desactualizada' THEN
    v_tpl := 'ofrecimiento-matricula-desactualizada';
    SELECT a.matricula_rpac_vencimiento INTO v_fv FROM public.administraciones a WHERE a.id = p_admin;
    v_push_titulo := 'Tu matrícula figura vencida';
    v_push_cuerpo := '¿Ya la renovaste o la gestionamos nosotros? Revisá tu agenda.';
    v_push_url := '/portal/mi-ficha?origen=ofrecimiento';
  ELSIF p_codigo = 'perfil_incompleto' THEN
    v_tpl := 'ofrecimiento-perfil-incompleto';
    v_push_titulo := 'Armá tu agenda de vencimientos';
    v_push_cuerpo := 'Completá tu perfil y dejá que los recordatorios trabajen por vos.';
    v_push_url := '/portal/mi-ficha?origen=ofrecimiento';
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
    v_vars := v_vars || jsonb_build_object('dias_restantes', GREATEST(0, (v_prox - p_ancla))::text, 'fecha_vencimiento', to_char(v_prox, 'DD/MM/YYYY'));
  END IF;
  IF p_codigo = 'matricula_desactualizada' AND v_fv IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_fv, 'DD/MM/YYYY'));
  END IF;

  BEGIN
    IF p_email IS NULL OR trim(p_email) = '' THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'skipped', 'sin_email') ON CONFLICT DO NOTHING;
    ELSIF public.email_esta_suprimido(p_email) THEN
      -- DGG-224 F1: baja/opt-out o rebote → la lista global de supresión manda.
      -- No se encola el email de marketing; se deja rastro auditable.
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'skipped', 'suprimido') ON CONFLICT DO NOTHING;
    ELSE
      SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_tpl AND activo;
      IF v_asunto IS NULL THEN
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', 'template_inexistente') ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.email_queue
          (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at, administracion_id, related_table, related_id, subject, comprobante_ids, parte, partes_total)
        VALUES
          ('workflow', v_tpl, trim(p_email), p_contacto, v_vars, 7, now(), now(), p_admin, 'administraciones', p_admin, v_asunto, '{}', 1, 1);
        INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado)
        VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'ok') ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, template_slug, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'email', v_tpl, 'error', SQLERRM) ON CONFLICT DO NOTHING;
  END;

  BEGIN
    IF p_user IS NULL THEN
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'skipped', 'sin_usuario_portal') ON CONFLICT DO NOTHING;
    ELSE
      PERFORM private.notif_emitir(p_user, 'ofrecimiento', v_push_titulo, v_push_cuerpo, v_push_url, '{}'::jsonb);
      INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
      VALUES (p_admin, p_codigo, p_ancla, 'push', 'ok') ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado, detalle)
    VALUES (p_admin, p_codigo, p_ancla, 'push', 'error', SQLERRM) ON CONFLICT DO NOTHING;
  END;

  INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
  VALUES (p_admin, p_codigo, p_ancla, 'banner', 'ok') ON CONFLICT DO NOTHING;
END;
$function$;
