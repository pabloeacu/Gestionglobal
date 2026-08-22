-- 0445_dgg142e4_f4_motor_ofrecimientos_diario.sql
-- DGG-142 · Etapa 4 · F4 — MOTOR DIARIO de ofrecimientos (cadencias móviles
-- de la matriz DGG-143) con canal triple: email (plantilla por servicio, mig
-- 0443) + push/campanita al cliente (private.notif_emitir) + banner (el
-- dashboard F5 lee ofrecimientos_log canal 'banner' para forzar la card del
-- día). Reglas implementadas:
--   · certificado_90: cada 90 días móviles, clientes RPAC no SOLO-CABA que no
--     contrataron certificado en esos 90 días.
--   · cj_120: cada 120 días, clientes RPAC *y también* SOLO-CABA (decisión F).
--   · curso_actualizacion_60: cada 60 días, clientes RPAC que (a) no renovaron
--     matrícula en 60 días (por CIERRE satisfactorio, doctrina 0355) y (b) no
--     hicieron el curso PBA de actualización en 12 meses móviles.
--   · ddjj_ciclo: noviembre→marzo, cada 30 días, salvo quienes contrataron la
--     DDJJ dentro del ciclo (ancla 1-nov, cruza año nuevo).
--   · capacitacion one-shot: al publicarse un formulario de evento, UNA única
--     invitación a los clientes elegibles no inscriptos (incluye SOLO-CABA).
--     Marca formularios.publicado_notificado_at (patrón 0376) + backfill
--     anti-spam del stock ya publicado.
--   · (riel CABA) genera/actualiza la fila `vencimientos` tipo curso_rpa_caba
--     con offsets {30,15,0} desde la última matrícula CABA — la resuelve
--     dispatch-vencimientos (F3).
--
-- Anti-spam: máx 1 ofrecimiento por cliente por día (prioridad ddjj > curso >
-- certificado > cj) + cap global de 40 toques por corrida (lo que no entra
-- cae naturalmente mañana) + dedupe por ventana vía ofrecimientos_log
-- (enviado_at, NUNCA recalculado sobre el now() del envío) + UNIQUE
-- (admin, codigo, ciclo_ancla=v_hoy, canal) que hace inocuo un doble run.
-- R17: la función es SECURITY DEFINER (escribe en ofrecimientos_log, RLS
-- sólo-SELECT). Fechas SIEMPRE en calendario ART.

ALTER TABLE public.formularios
  ADD COLUMN IF NOT EXISTS publicado_notificado_at timestamptz;
COMMENT ON COLUMN public.formularios.publicado_notificado_at IS
  'DGG-142 E4 · marca one-shot: la invitación de capacitación gratuita ya salió para este formulario (patrón 0376). Se setea aunque haya 0 destinatarios.';

-- Backfill anti-spam: lo ya publicado al aplicar la mig NO genera invitación.
UPDATE public.formularios
   SET publicado_notificado_at = now()
 WHERE categoria = 'evento' AND activo = true
   AND publicado_notificado_at IS NULL;

CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_diario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_mes int := EXTRACT(MONTH FROM v_hoy)::int;
  v_ciclo_ddjj date := make_date(
    EXTRACT(YEAR FROM v_hoy)::int - CASE WHEN EXTRACT(MONTH FROM v_hoy) >= 11 THEN 0 ELSE 1 END,
    11, 1);
  v_cap int := 40;          -- cap global de toques por corrida (anti-avalancha)
  v_toques int := 0;
  v_res jsonb := '{}'::jsonb;
  v_admin record;
  v_regla text;
  v_form record;
  v_cnt_cert int := 0; v_cnt_cj int := 0; v_cnt_curso int := 0;
  v_cnt_ddjj int := 0; v_cnt_cap int := 0; v_cnt_caba_venc int := 0;
BEGIN
  -- ── 0 · Riel CABA: fila vencimientos por aniversario de la última
  --        matrícula CABA (30/15/0 lo dispara dispatch-vencimientos).
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
    SELECT u.admin_id, u.aniversario
    FROM ult u
    JOIN public.administraciones a ON a.id = u.admin_id
    WHERE u.admin_id IS NOT NULL AND u.aniversario >= v_hoy
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
         'vigente', '{30,15,0}'::int[], true
  FROM objetivo o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento = o.aniversario
  );
  GET DIAGNOSTICS v_cnt_caba_venc = ROW_COUNT;

  -- ── 1 · Cadencias móviles: máx 1 regla por cliente por día.
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados
      AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;

    -- ya tocado hoy → mañana será otro día
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla = v_hoy);

    v_regla := NULL;

    -- prioridad 1 · DDJJ (nov→mar, cada 30 días, salvo contratada en el ciclo)
    IF v_mes IN (11,12,1,2,3)
       AND private.gg_admin_es_rpac(v_admin.id)
       AND NOT private.gg_admin_es_solo_caba(v_admin.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id AND s.codigo = 'rpac_ddjj'
           AND t.estado <> 'cancelado' AND t.created_at >= v_ciclo_ddjj)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'ddjj_ciclo'
           AND ol.enviado_at >= (v_hoy - 30)::timestamptz)
    THEN
      v_regla := 'ddjj_ciclo';

    -- prioridad 2 · Curso de Actualización RPAC (cada 60 días, condiciones a+b)
    ELSIF private.gg_admin_es_rpac(v_admin.id)
       AND NOT private.gg_admin_es_solo_caba(v_admin.id)
       AND NOT EXISTS (   -- (a) renovó matrícula (cierre que prosperó) en 60 días
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id
           AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
           AND t.estado = 'cerrado'
           AND t.cierre_satisfactorio IS DISTINCT FROM false
           AND COALESCE(t.fecha_fin::timestamptz, t.resuelto_at) >= now() - interval '60 days')
       AND NOT EXISTS (   -- (b) hizo el curso PBA de actualización en 12 meses móviles
         SELECT 1 FROM public.curso_matriculas cm
         JOIN public.cursos c ON c.id = cm.curso_id
         LEFT JOIN public.profiles p ON p.id = cm.profile_id
         WHERE COALESCE(cm.administracion_id, p.administracion_id) = v_admin.id
           AND cm.estado <> 'anulada'
           AND c.jurisdiccion = 'pba' AND c.slug ILIKE '%actualizacion%'
           AND cm.inscripto_at >= now() - interval '12 months')
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'curso_actualizacion_60'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'curso_actualizacion_60';

    -- prioridad 3 · Certificado de acreditación (cada 90 días móviles)
    ELSIF private.gg_admin_es_rpac(v_admin.id)
       AND NOT private.gg_admin_es_solo_caba(v_admin.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id AND s.codigo = 'rpac_certificado'
           AND t.estado <> 'cancelado' AND t.created_at >= now() - interval '90 days')
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'certificado_90'
           AND ol.enviado_at >= (v_hoy - 90)::timestamptz)
    THEN
      v_regla := 'certificado_90';

    -- prioridad 4 · Consultoría jurídica (cada 120 días; incluye SOLO-CABA)
    ELSIF (private.gg_admin_es_rpac(v_admin.id) OR private.gg_admin_hizo_curso_caba(v_admin.id))
       AND NOT EXISTS (
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id AND s.codigo = 'juridico_consulta'
           AND t.estado <> 'cancelado' AND t.created_at >= now() - interval '120 days')
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
    IF v_regla = 'ddjj_ciclo' THEN v_cnt_ddjj := v_cnt_ddjj + 1;
    ELSIF v_regla = 'curso_actualizacion_60' THEN v_cnt_curso := v_cnt_curso + 1;
    ELSIF v_regla = 'certificado_90' THEN v_cnt_cert := v_cnt_cert + 1;
    ELSE v_cnt_cj := v_cnt_cj + 1;
    END IF;
  END LOOP;

  -- ── 2 · Capacitación gratuita: one-shot al publicarse el formulario.
  FOR v_form IN
    SELECT f.id, f.slug, f.titulo, f.webinar_id, w.fecha_hora
    FROM public.formularios f
    LEFT JOIN public.webinars w ON w.id = f.webinar_id
    WHERE f.categoria = 'evento' AND f.activo = true AND f.publico = true
      AND f.publicado_notificado_at IS NULL
  LOOP
    FOR v_admin IN
      SELECT a.id, a.nombre, a.email, a.user_id,
             COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
      FROM public.administraciones a
      WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
        AND (private.gg_admin_es_rpac(a.id) OR private.gg_admin_hizo_curso_caba(a.id))
        AND (v_form.webinar_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.webinar_inscriptos wi
          WHERE wi.webinar_id = v_form.webinar_id AND wi.administracion_id = a.id))
    LOOP
      EXIT WHEN v_toques >= v_cap;
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
    -- marca one-shot SIEMPRE (aunque 0 destinatarios o cap alcanzado a medias:
    -- si el cap cortó, los restantes NO se re-invitan — preferimos no duplicar
    -- a nadie; el alcance del one-shot es best-effort del día de publicación).
    UPDATE public.formularios SET publicado_notificado_at = now() WHERE id = v_form.id;
  END LOOP;

  v_res := jsonb_build_object(
    'fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'ddjj', v_cnt_ddjj, 'curso_actualizacion', v_cnt_curso,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_vencimientos_generados', v_cnt_caba_venc);
  RETURN v_res;
END;
$$;

-- Helper interno: ejecuta el TOQUE triple (email + push/campanita + banner)
-- y lo registra en ofrecimientos_log por canal. Best-effort por canal: el
-- fallo de uno no aborta los otros.
CREATE OR REPLACE FUNCTION public._gg_ofrecimiento_tocar(
  p_admin uuid, p_contacto text, p_email text, p_user uuid,
  p_codigo text, p_ancla date,
  p_titulo text DEFAULT NULL, p_form_url text DEFAULT NULL, p_fecha_detalle text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tpl text;
  v_asunto text;
  v_vars jsonb;
  v_push_titulo text;
  v_push_cuerpo text;
  v_push_url text;
BEGIN
  -- Mapa regla → plantilla / push / URL
  IF p_codigo = 'ddjj_ciclo' THEN
    v_tpl := 'ofrecimiento-ddjj';
    v_push_titulo := 'Tu DDJJ anual vence en marzo';
    v_push_cuerpo := 'La preparamos y presentamos por vos. Arrancá hoy.';
    v_push_url := '/formulario/ddjj-anual?origen=ofrecimiento';
  ELSIF p_codigo = 'curso_actualizacion_60' THEN
    v_tpl := 'ofrecimiento-curso-actualizacion-rpac';
    v_push_titulo := 'Curso de Actualización RPAC';
    v_push_cuerpo := 'Requisito anual para tu matrícula. Reservá tu lugar.';
    v_push_url := '/formulario/curso-actualizacion?origen=ofrecimiento';
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
  ELSE  -- capacitacion:<form_id>
    v_tpl := 'ofrecimiento-capacitacion-gratuita';
    v_push_titulo := 'Nueva capacitación gratuita';
    v_push_cuerpo := COALESCE(p_titulo, 'Inscribite sin costo — cupos limitados.');
    v_push_url := COALESCE(replace(p_form_url, 'https://gestionglobal.ar', ''), '/portal');
  END IF;

  v_vars := jsonb_build_object('nombre', p_contacto);
  IF p_titulo IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('titulo', p_titulo); END IF;
  IF p_form_url IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('form_url', p_form_url); END IF;
  IF p_fecha_detalle IS NOT NULL THEN v_vars := v_vars || jsonb_build_object('fecha_detalle', p_fecha_detalle); END IF;

  -- canal EMAIL
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

  -- canal PUSH + campanita (no-op sin usuario de portal)
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

  -- canal BANNER (marca del día — la lee el dashboard del portal en F5)
  INSERT INTO public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal, resultado)
  VALUES (p_admin, p_codigo, p_ancla, 'banner', 'ok')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gg_ofrecimientos_diario() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._gg_ofrecimiento_tocar(uuid, text, text, uuid, text, date, text, text, text) FROM PUBLIC, anon, authenticated;

-- Cron SQL directo (patrón robusto post-mortem 0373: sin http ni GUCs).
-- 09:30 ART, después del dispatch-vencimientos de las 09:00.
SELECT cron.schedule(
  'gg-ofrecimientos-diario',
  '30 12 * * *',
  $$SELECT public.gg_ofrecimientos_diario();$$
);
