-- 0592_dgg226_motor_gate_frescura.sql
-- DGG-226 · BLINDAJE (3/3) — GATE DE FRESCURA EN EL MOTOR DE OFRECIMIENTOS
-- ("re-verificá contra TRAMIX antes del aviso").
--
-- Las 3 reglas cuyo disparo depende de la FECHA de vencimiento de la matrícula
-- —'matricula_desactualizada' (vencida), 'renovacion_venc' (≤45d) y
-- 'curso_venc' (15-60d)— sólo mandan el aviso si el legajo tiene un scrapeo
-- TRAMIX FRESCO (≤15 días). Si no, se encola para scrapear (motivo='vencimiento',
-- consumido por el worker de cierre a 1 cada 5 min → ritmo IP-safe) y el aviso
-- se POSPONE: el scrapeo re-deriva la ficha forward-only (mig 0591) y la próxima
-- corrida del motor decide con dato fresco. Si para entonces NO está vencida,
-- la regla ya no dispara → no se manda el mail. Pedido textual de Pablo.
--
-- No falla hacia una regla de menor prioridad: si la necesidad top del admin es
-- un aviso de vencimiento que no podemos verificar, se difiere por completo esa
-- corrida (no se sustituye por otro ofrecimiento).
--
-- Reglas: R16 (gg_ofrecimientos_diario mantiene firma () → CREATE OR REPLACE ok),
-- R17 (helper de encolado SECDEF: escribe cola RLS sin policy de write), R18
-- (smoke e2e de la RPC en el cierre de chunk).

-- ───────────────────────────────────────────────────────────────────────────
-- A) ¿El legajo del admin tiene scrapeo TRAMIX fresco? (≤15 días)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.gg_venc_tramix_fresco(p_admin uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.administraciones a
    JOIN public.tramix_cache tc
      ON regexp_replace(COALESCE(tc.legajo,''),      '[^0-9]', '', 'g')
       = regexp_replace(COALESCE(a.legajo_rpac,''),  '[^0-9]', '', 'g')
    WHERE a.id = p_admin
      AND regexp_replace(COALESCE(a.legajo_rpac,''), '[^0-9]', '', 'g') <> ''
      AND tc.consultado_at > now() - interval '15 days'
  );
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- B) Encolar el legajo para re-verificación de vencimiento (con backoff).
--    Comparte la cola del cierre; marca motivo='vencimiento' para que el planner
--    no la borre. Backoff: NO re-abre una fila que falló (flag/error) en los
--    últimos 14 días → no se martilla un legajo NOT_FOUND todos los días.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.gg_venc_encolar_refresh(p_admin uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_leg text;
BEGIN
  SELECT regexp_replace(COALESCE(a.legajo_rpac,''), '[^0-9]', '', 'g')
    INTO v_leg
  FROM public.administraciones a WHERE a.id = p_admin;

  IF COALESCE(v_leg,'') = '' THEN RETURN; END IF;

  INSERT INTO public.tramix_cierre_refresh_queue (legajo, admin_id, motivo, estado, intentos)
  VALUES (v_leg, p_admin, 'vencimiento', 'pendiente', 0)
  ON CONFLICT (legajo) DO UPDATE
     SET estado    = 'pendiente',
         intentos  = 0,
         motivo    = 'vencimiento',
         admin_id  = COALESCE(public.tramix_cierre_refresh_queue.admin_id, EXCLUDED.admin_id),
         updated_at = now()
   WHERE public.tramix_cierre_refresh_queue.estado NOT IN ('pendiente','procesando')
     AND NOT (public.tramix_cierre_refresh_queue.estado IN ('flag','error')
              AND public.tramix_cierre_refresh_queue.updated_at > now() - interval '14 days');
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C) Motor diario — inyecta el gate tras elegir la regla. ÚNICO cambio vs la
--    versión previa: el bloque "DGG-226 blindaje" + el contador v_cnt_diferido
--    + el campo 'diferido_verificacion' del retorno. Resto verbatim.
-- ───────────────────────────────────────────────────────────────────────────
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
  v_cnt_desact int := 0; v_cnt_perfil int := 0;
  v_cnt_diferido int := 0;
BEGIN
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
      AND a.activo AND a.estado <> 'baja' AND a.ofrecimientos_habilitados
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
          WHERE ol.administracion_id = a.id AND ol.codigo = 'capacitacion:' || v_form.id::text)
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id AND ol.ciclo_ancla = v_hoy)
    LOOP
      IF v_toques >= v_cap THEN v_cap_cut := true; EXIT; END IF;
      PERFORM public._gg_ofrecimiento_tocar(
        v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id,
        'capacitacion:' || v_form.id::text, v_hoy, v_form.titulo,
        'https://gestionglobal.ar/formulario/' || v_form.slug || '?origen=ofrecimiento',
        CASE WHEN v_form.fecha_hora IS NOT NULL
             THEN ' · ' || to_char(v_form.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' hs'
             ELSE '' END);
      v_toques := v_toques + 1; v_cnt_cap := v_cnt_cap + 1;
    END LOOP;
    IF NOT v_cap_cut THEN
      UPDATE public.formularios SET publicado_notificado_at = now() WHERE id = v_form.id;
    END IF;
  END LOOP;

  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla >= v_hoy - 7);
    v_regla := NULL;
    IF private.gg_ofrecimiento_elegible(v_admin.id, 'matriculacion', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'matriculacion' AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN v_regla := 'matriculacion';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'ddjj_ciclo', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'ddjj_ciclo' AND ol.enviado_at >= (v_hoy - 30)::timestamptz)
    THEN v_regla := 'ddjj_ciclo';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'curso_venc', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'curso_venc' AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN v_regla := 'curso_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'renovacion_venc', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'renovacion_venc' AND ol.enviado_at >= (v_hoy - 45)::timestamptz)
    THEN v_regla := 'renovacion_venc';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'matricula_desactualizada', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'matricula_desactualizada' AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN v_regla := 'matricula_desactualizada';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'certificado_90', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'certificado_90' AND ol.enviado_at >= (v_hoy - 90)::timestamptz)
    THEN v_regla := 'certificado_90';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'cj_120', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'cj_120' AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN v_regla := 'cj_120';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'perfil_incompleto', v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'perfil_incompleto' AND ol.enviado_at >= (v_hoy - 120)::timestamptz)
    THEN v_regla := 'perfil_incompleto';
    END IF;

    -- ── DGG-226 · BLINDAJE DE VENCIMIENTO ──────────────────────────────────
    -- Las reglas basadas en la FECHA de vencimiento no mandan sin re-verificar
    -- contra TRAMIX fresco. Sin dato fresco → encolar scrapeo + posponer.
    IF v_regla IN ('curso_venc','renovacion_venc','matricula_desactualizada')
       AND NOT private.gg_venc_tramix_fresco(v_admin.id) THEN
      PERFORM private.gg_venc_encolar_refresh(v_admin.id);
      v_cnt_diferido := v_cnt_diferido + 1;
      v_regla := NULL;
    END IF;
    -- ───────────────────────────────────────────────────────────────────────

    CONTINUE WHEN v_regla IS NULL;
    PERFORM public._gg_ofrecimiento_tocar(v_admin.id, v_admin.contacto, v_admin.email, v_admin.user_id, v_regla, v_hoy);
    v_toques := v_toques + 1;
    IF v_regla = 'matriculacion' THEN v_cnt_matric := v_cnt_matric + 1;
    ELSIF v_regla = 'ddjj_ciclo' THEN v_cnt_ddjj := v_cnt_ddjj + 1;
    ELSIF v_regla = 'curso_venc' THEN v_cnt_curso := v_cnt_curso + 1;
    ELSIF v_regla = 'renovacion_venc' THEN v_cnt_renov := v_cnt_renov + 1;
    ELSIF v_regla = 'matricula_desactualizada' THEN v_cnt_desact := v_cnt_desact + 1;
    ELSIF v_regla = 'certificado_90' THEN v_cnt_cert := v_cnt_cert + 1;
    ELSIF v_regla = 'perfil_incompleto' THEN v_cnt_perfil := v_cnt_perfil + 1;
    ELSE v_cnt_cj := v_cnt_cj + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'matriculacion', v_cnt_matric, 'ddjj', v_cnt_ddjj,
    'curso_actualizacion', v_cnt_curso, 'renovacion', v_cnt_renov,
    'matricula_desactualizada', v_cnt_desact, 'perfil_incompleto', v_cnt_perfil,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_vencimientos_generados', v_cnt_caba_venc,
    'diferido_verificacion', v_cnt_diferido);
END;
$function$;
