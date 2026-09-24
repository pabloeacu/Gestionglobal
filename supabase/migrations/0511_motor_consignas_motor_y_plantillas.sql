-- 0511 · Agenda · alineación del motor a las consignas (DGG-200) — parte 2: motor + plantillas + preview.
--
-- Depende de 0510 (reglas nuevas: matriculacion, curso_venc, renovacion_venc; cert/ddjj gated por
-- matrícula CONOCIDA; cj a todos). Acá:
--   1. Plantilla email `ofrecimiento-matriculacion` (C3, nueva).
--   2. `_gg_ofrecimiento_tocar`: ramas nuevas (matriculacion, curso_venc, renovacion_venc) +
--      renovación pasa dias_restantes/fecha_vencimiento (la plantilla los usa).
--   3. `gg_ofrecimientos_diario` §2: precedencia nueva
--        matriculacion → ddjj_ciclo → curso_venc → renovacion_venc → certificado_90 → cj_120.
--   4. `gg_ofrecimientos_diario_sombra` §2: MISMA precedencia (lockstep, sin drift).
--   5. `gg_ofrecimientos_preview`: tiles nuevos (matriculacion, renovacion) + prox_venc_matricula (C6).
-- El motor real SIGUE DORMIDO (sin cron); la sombra sigue corriendo. Nada de esto envía comms reales.

-- ── 1) plantilla email de matriculación (C3) ──
INSERT INTO public.email_templates
  (slug, nombre, asunto, descripcion, body_html, body_text, from_casilla, activo, variables,
   kicker, titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual, firma, cta_text, cta_url, layout_version)
VALUES (
  'ofrecimiento-matriculacion',
  'Ofrecimiento · Matriculación RPAC',
  'Matriculate en el RPAC: hacemos el trámite por vos · Gestión Global',
  'Motor de ofrecimientos (DGG-200 / C3): a administradores sin matrícula registrada, para gestionar su matriculación RPAC.',
  '<!-- manaxer-v1 -->', NULL, 'general', true, '["nombre"]'::jsonb,
  'MATRICULACIÓN RPAC',
  'Tu matrícula de administrador, sin vueltas',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Hola {{nombre}}: para ejercer como administrador/a de consorcios con respaldo, necesitás tu <strong>matrícula RPAC</strong> (Registro Público de Administradores de Consorcios). Nosotros hacemos todo el trámite por vos.</p>'
  || '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Te acompañamos paso a paso: documentación, presentación y seguimiento hasta que tengas tu número de matrícula.</p>'
  || '<p style="margin:0;color:#1e293b;">¿Ya estás matriculado/a? <a href="https://gestionglobal.ar/portal/mi-ficha" style="color:#0891b2;font-weight:600;">Cargá tu número en tu ficha</a> y dejamos de recordártelo — así activamos tus trámites de renovación, DDJJ y certificados.</p>',
  'Equipo Gestión Global',
  'Quiero matricularme',
  'https://gestionglobal.ar/formulario/matriculacion-rpac?origen=ofrecimiento',
  'manaxer-v1')
ON CONFLICT (slug) DO NOTHING;

-- ── 2) touch helper: ramas nuevas + vars de renovación ──
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
  -- la plantilla de renovación usa {{dias_restantes}} y {{fecha_vencimiento}}
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

-- ── 3) motor REAL: §2 con precedencia nueva (§0 CABA y §1 capacitación intactos) ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cap int := 40;
  v_toques int := 0;
  v_cap_cut boolean := false;
  v_admin record;
  v_regla text;
  v_form record;
  v_cnt_cert int := 0; v_cnt_cj int := 0; v_cnt_curso int := 0;
  v_cnt_ddjj int := 0; v_cnt_cap int := 0; v_cnt_caba_venc int := 0;
  v_cnt_matric int := 0; v_cnt_renov int := 0;
BEGIN
  -- §0 · CABA: sembrar/actualizar el vencimiento de curso RPA (CABA). (Sin cambios.)
  WITH ult AS (
    SELECT COALESCE(cm.administracion_id, p.administracion_id) AS admin_id,
           max(COALESCE(cm.vigencia_hasta,
               ((cm.inscripto_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                 + interval '12 months')::date)) AS aniversario
    FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id AND c.jurisdiccion = 'caba'
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.estado <> 'anulada'
    GROUP BY 1
  ), objetivo AS (
    SELECT u.admin_id, u.aniversario, a.ofrecimientos_habilitados AS notif
    FROM ult u
    JOIN public.administraciones a ON a.id = u.admin_id
    WHERE u.admin_id IS NOT NULL AND u.aniversario >= v_hoy
      AND a.activo AND a.estado <> 'baja'
      AND a.ofrecimientos_habilitados
  ), superseded AS (
    UPDATE public.vencimientos v SET estado = 'renovado'
    FROM objetivo o
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento <> o.aniversario
    RETURNING v.id
  )
  INSERT INTO public.vencimientos
    (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento,
     fecha_emision, descripcion, estado, alarmas_offsets, notificar_cliente)
  SELECT 'curso_rpa_caba', 'administracion', o.admin_id, o.admin_id,
         o.aniversario, v_hoy, 'Aniversario Curso de Actualización RPA (CABA)',
         'vigente', '{30,15,0}'::int[], o.notif
  FROM objetivo o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento = o.aniversario
  );
  GET DIAGNOSTICS v_cnt_caba_venc = ROW_COUNT;

  -- §1 · Capacitaciones nuevas (evento público sin notificar). (Sin cambios.)
  FOR v_form IN
    SELECT f.id, f.slug, f.titulo, f.webinar_id, w.fecha_hora
    FROM public.formularios f
    LEFT JOIN public.webinars w ON w.id = f.webinar_id
    WHERE f.categoria = 'evento' AND f.activo = true AND f.publico = true
      AND f.publicado_notificado_at IS NULL
  LOOP
    v_cap_cut := false;
    FOR v_admin IN
      SELECT a.id, a.nombre, a.email, a.user_id,
             COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
      FROM public.administraciones a
      WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
        AND (private.gg_admin_es_rpac(a.id) OR private.gg_admin_hizo_curso_caba(a.id))
        AND (v_form.webinar_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.webinar_inscriptos wi
          WHERE wi.webinar_id = v_form.webinar_id AND wi.administracion_id = a.id))
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id
            AND ol.codigo = 'capacitacion:' || v_form.id::text)
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id AND ol.ciclo_ancla = v_hoy)
    LOOP
      IF v_toques >= v_cap THEN v_cap_cut := true; EXIT; END IF;
      PERFORM public._gg_ofrecimiento_tocar(
        v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id,
        'capacitacion:' || v_form.id::text, v_hoy,
        v_form.titulo,
        'https://gestionglobal.ar/formulario/' || v_form.slug || '?origen=ofrecimiento',
        CASE WHEN v_form.fecha_hora IS NOT NULL
             THEN ' · ' || to_char(v_form.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' hs'
             ELSE '' END);
      v_toques := v_toques + 1;
      v_cnt_cap := v_cnt_cap + 1;
    END LOOP;
    IF NOT v_cap_cut THEN
      UPDATE public.formularios SET publicado_notificado_at = now() WHERE id = v_form.id;
    END IF;
  END LOOP;

  -- §2 · Cadencias por regla. Precedencia:
  --   matriculacion → ddjj_ciclo → curso_venc → renovacion_venc → certificado_90 → cj_120
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados
      AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;

    -- gracia global 7 días (un solo ofrecimiento por semana por admin)
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla >= v_hoy - 7);

    v_regla := NULL;

    IF private.gg_ofrecimiento_elegible(v_admin.id, 'matriculacion', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'matriculacion'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'matriculacion';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'ddjj_ciclo', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'ddjj_ciclo'
           AND ol.enviado_at >= (v_hoy - 30)::timestamptz)
    THEN
      v_regla := 'ddjj_ciclo';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'curso_venc', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'curso_venc'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'curso_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'renovacion_venc', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'renovacion_venc'
           AND ol.enviado_at >= (v_hoy - 45)::timestamptz)
    THEN
      v_regla := 'renovacion_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'certificado_90', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'certificado_90'
           AND ol.enviado_at >= (v_hoy - 90)::timestamptz)
    THEN
      v_regla := 'certificado_90';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'cj_120', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'cj_120'
           AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN
      v_regla := 'cj_120';
    END IF;

    CONTINUE WHEN v_regla IS NULL;

    PERFORM public._gg_ofrecimiento_tocar(
      v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id,
      v_regla, v_hoy);
    v_toques := v_toques + 1;
    IF v_regla = 'matriculacion' THEN v_cnt_matric := v_cnt_matric + 1;
    ELSIF v_regla = 'ddjj_ciclo' THEN v_cnt_ddjj := v_cnt_ddjj + 1;
    ELSIF v_regla = 'curso_venc' THEN v_cnt_curso := v_cnt_curso + 1;
    ELSIF v_regla = 'renovacion_venc' THEN v_cnt_renov := v_cnt_renov + 1;
    ELSIF v_regla = 'certificado_90' THEN v_cnt_cert := v_cnt_cert + 1;
    ELSE v_cnt_cj := v_cnt_cj + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'matriculacion', v_cnt_matric, 'ddjj', v_cnt_ddjj,
    'curso_actualizacion', v_cnt_curso, 'renovacion', v_cnt_renov,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_vencimientos_generados', v_cnt_caba_venc);
END;
$function$;

-- ── 4) motor SOMBRA: §2 en lockstep con el real (§0 CABA fidelidad E-GG-215 y §1 intactos) ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_diario_sombra()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cap int := 40;
  v_toques int := 0;
  v_cap_cut boolean := false;
  v_admin record; v_regla text; v_form record;
  v_cnt_cert int:=0; v_cnt_cj int:=0; v_cnt_curso int:=0;
  v_cnt_ddjj int:=0; v_cnt_cap int:=0; v_cnt_caba int:=0;
  v_cnt_matric int:=0; v_cnt_renov int:=0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ofrecimientos_sombra WHERE corrida_fecha = v_hoy) THEN
    RETURN jsonb_build_object('fecha', v_hoy, 'skipped', 'ya_corrio_hoy');
  END IF;

  -- §0 · CABA (fidelidad E-GG-215: ciclo_ancla=aniversario estable + dedup contra la propia sombra).
  WITH ult AS (
    SELECT COALESCE(cm.administracion_id, p.administracion_id) AS admin_id,
           max(COALESCE(cm.vigencia_hasta,
               ((cm.inscripto_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + interval '12 months')::date)) AS aniversario
    FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id AND c.jurisdiccion = 'caba'
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.estado <> 'anulada' GROUP BY 1
  ), objetivo AS (
    SELECT u.admin_id, u.aniversario FROM ult u
    JOIN public.administraciones a ON a.id = u.admin_id
    WHERE u.admin_id IS NOT NULL AND u.aniversario >= v_hoy
      AND a.activo AND a.estado <> 'baja' AND a.ofrecimientos_habilitados
  )
  INSERT INTO public.ofrecimientos_sombra (corrida_fecha, administracion_id, admin_nombre, codigo, ciclo_ancla)
  SELECT v_hoy, o.admin_id, a.nombre, 'caba_venc', o.aniversario
  FROM objetivo o JOIN public.administraciones a ON a.id=o.admin_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento = o.aniversario)
    AND NOT EXISTS (
    SELECT 1 FROM public.ofrecimientos_sombra s2
    WHERE s2.administracion_id = o.admin_id AND s2.codigo = 'caba_venc' AND s2.ciclo_ancla = o.aniversario);
  GET DIAGNOSTICS v_cnt_caba = ROW_COUNT;

  -- §1 · Capacitación (dedup por form + por día EXCLUYENDO caba_venc + no-inscripto al webinar).
  FOR v_form IN
    SELECT f.id, f.titulo, f.webinar_id FROM public.formularios f
    WHERE f.categoria = 'evento' AND f.activo = true AND f.publico = true
      AND f.publicado_notificado_at IS NULL
  LOOP
    v_cap_cut := false;
    FOR v_admin IN
      SELECT a.id, a.nombre, a.email, a.user_id
      FROM public.administraciones a
      WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
        AND (private.gg_admin_es_rpac(a.id) OR private.gg_admin_hizo_curso_caba(a.id))
        AND (v_form.webinar_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.webinar_inscriptos wi
          WHERE wi.webinar_id = v_form.webinar_id AND wi.administracion_id = a.id))
        AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
          WHERE s.administracion_id = a.id AND s.codigo = 'capacitacion:' || v_form.id::text)
        AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
          WHERE s.administracion_id = a.id AND s.ciclo_ancla = v_hoy AND s.codigo <> 'caba_venc')
    LOOP
      IF v_toques >= v_cap THEN v_cap_cut := true; EXIT; END IF;
      INSERT INTO public.ofrecimientos_sombra (corrida_fecha, administracion_id, admin_nombre, codigo, ciclo_ancla, email, tiene_push)
      VALUES (v_hoy, v_admin.id, v_admin.nombre, 'capacitacion:' || v_form.id::text, v_hoy,
              NULLIF(trim(v_admin.email),''), v_admin.user_id IS NOT NULL);
      v_toques := v_toques + 1; v_cnt_cap := v_cnt_cap + 1;
    END LOOP;
  END LOOP;

  -- §2 · Cadencias (misma precedencia que el motor real; gracia 7d EXCLUYENDO caba_venc).
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
      WHERE s.administracion_id = v_admin.id AND s.ciclo_ancla >= v_hoy - 7 AND s.codigo <> 'caba_venc');

    v_regla := NULL;
    IF private.gg_ofrecimiento_elegible(v_admin.id,'matriculacion',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='matriculacion' AND s.ciclo_ancla >= v_hoy-60)
    THEN v_regla := 'matriculacion';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'ddjj_ciclo',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='ddjj_ciclo' AND s.ciclo_ancla >= v_hoy-30)
    THEN v_regla := 'ddjj_ciclo';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'curso_venc',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='curso_venc' AND s.ciclo_ancla >= v_hoy-60)
    THEN v_regla := 'curso_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'renovacion_venc',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='renovacion_venc' AND s.ciclo_ancla >= v_hoy-45)
    THEN v_regla := 'renovacion_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'certificado_90',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='certificado_90' AND s.ciclo_ancla >= v_hoy-90)
    THEN v_regla := 'certificado_90';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'cj_120',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='cj_120' AND s.ciclo_ancla >= v_hoy-120)
    THEN v_regla := 'cj_120';
    END IF;

    CONTINUE WHEN v_regla IS NULL;

    INSERT INTO public.ofrecimientos_sombra (corrida_fecha, administracion_id, admin_nombre, codigo, ciclo_ancla, email, tiene_push)
    VALUES (v_hoy, v_admin.id, v_admin.nombre, v_regla, v_hoy,
            NULLIF(trim(v_admin.email),''), v_admin.user_id IS NOT NULL);
    v_toques := v_toques + 1;
    IF v_regla='matriculacion' THEN v_cnt_matric:=v_cnt_matric+1;
    ELSIF v_regla='ddjj_ciclo' THEN v_cnt_ddjj:=v_cnt_ddjj+1;
    ELSIF v_regla='curso_venc' THEN v_cnt_curso:=v_cnt_curso+1;
    ELSIF v_regla='renovacion_venc' THEN v_cnt_renov:=v_cnt_renov+1;
    ELSIF v_regla='certificado_90' THEN v_cnt_cert:=v_cnt_cert+1;
    ELSE v_cnt_cj:=v_cnt_cj+1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'modo', 'sombra', 'toques', v_toques, 'cap', v_cap,
    'matriculacion', v_cnt_matric, 'ddjj', v_cnt_ddjj,
    'curso_actualizacion', v_cnt_curso, 'renovacion', v_cnt_renov,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_seed_intencion', v_cnt_caba);
END;
$function$;

-- ── 5) preview: tiles nuevos + prox_venc_matricula (C6) ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_preview(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_nr jsonb;
  v_prox date := private.gg_admin_prox_venc_matricula(p_administracion_id);
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  SELECT no_requiere INTO v_nr FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'prox_venc_matricula', to_char(v_prox, 'YYYY-MM-DD'),
    'matriculacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'matriculacion',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'matriculacion', false)),
    'certificado', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'certificado_90',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'certificado', false)),
    'consultoria', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'cj_120',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'consultoria', false)),
    'curso_actualizacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'curso_venc',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'curso_actualizacion', false)),
    'renovacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'renovacion_venc',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'renovacion', false)),
    'ddjj', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'ddjj_ciclo',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'ddjj', false))
  );
END $function$;