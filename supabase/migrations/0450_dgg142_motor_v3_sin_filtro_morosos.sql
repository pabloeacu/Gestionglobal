-- 0450_dgg142_motor_v3_sin_filtro_morosos.sql
-- DGG-142 · Etapa 4 — Motor de ofrecimientos v3: SE ELIMINA el filtro de
-- morosos (decisión de Pablo 2026-08-22, opción b — ver DGG-145).
--
-- Contexto: el motor v2 (mig 0447 §6 (6)) salteaba a los clientes con
-- deuda > 0 en las reglas de cross-sell PAGO (certificado_90,
-- curso_actualizacion_60, cj_120), con criterio propio "pendiente de
-- confirmación de Pablo". Pablo definió: **el ofrecimiento no discrimina
-- estado de cuenta — lo mismo para todos, únicamente basado en fechas**.
-- Racional textual: "si alguno nos debe algo y necesita contratar otra
-- cosa, la alarma de ese otro servicio puede ser lo que les empuje de
-- modo indirecto a regularizar".
--
-- Cambio quirúrgico respecto de v2 (0447): se quitan la variable v_deuda,
-- su SELECT desde cliente_deuda_neta() y los tres predicados `v_deuda = 0`.
-- Todo lo demás queda EXACTAMENTE igual (riel CABA, capacitación one-shot,
-- ventana de gracia 7d, dedupe por regla, cap 40). Firma idéntica
-- (sin args → jsonb) ⇒ CREATE OR REPLACE seguro por regla 16.
-- El cron sigue DESAGENDADO: esta mig no agenda nada.

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
  v_cap int := 40;
  v_toques int := 0;
  v_cap_cut boolean := false;
  v_admin record;
  v_regla text;
  v_form record;
  v_cnt_cert int := 0; v_cnt_cj int := 0; v_cnt_curso int := 0;
  v_cnt_ddjj int := 0; v_cnt_cap int := 0; v_cnt_caba_venc int := 0;
BEGIN
  -- ── 0 · Riel CABA (fila vencimientos 30/15/0). §6: + gates activo/baja,
  --        notificar espeja el switch.
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

  -- ── 1 · Capacitación gratuita PRIMERO (§6: sus toques bloquean cadencias
  --        hoy; el one-shot es time-critical y no espera gracia).
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
        -- §6 (3): ya invitado a ESTE form (cualquier día) → jamás duplicar
        AND NOT EXISTS (
          SELECT 1 FROM public.ofrecimientos_log ol
          WHERE ol.administracion_id = a.id
            AND ol.codigo = 'capacitacion:' || v_form.id::text)
        -- §6 (4): ya tocado hoy (otro form) → mañana
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
    -- §6 (3): marcar SOLO si el loop terminó completo — si el cap cortó, el
    -- form queda pendiente y el derrame sigue mañana (el dedupe por-admin
    -- garantiza que nadie reciba dos veces).
    IF NOT v_cap_cut THEN
      UPDATE public.formularios SET publicado_notificado_at = now() WHERE id = v_form.id;
    END IF;
  END LOOP;

  -- ── 2 · Cadencias móviles (máx 1 regla por cliente cada 7 días — §6 (5)).
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados
      AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;

    -- §6 (5): ventana de gracia — tocado en los últimos 7 días → esperar.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla >= v_hoy - 7);

    -- DGG-145: el estado de cuenta NO filtra ningún ofrecimiento (v3).

    v_regla := NULL;

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

    ELSIF private.gg_admin_es_rpac(v_admin.id)
       AND NOT private.gg_admin_es_solo_caba(v_admin.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id
           AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
           AND t.estado = 'cerrado'
           AND t.cierre_satisfactorio IS DISTINCT FROM false
           AND COALESCE(t.fecha_fin::timestamptz, t.resuelto_at) >= now() - interval '60 days')
       AND NOT EXISTS (   -- §6 (8): ya CONTRATÓ el curso (trámite) en 12 meses
         SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
         WHERE t.administracion_id = v_admin.id AND s.codigo = 'curso_actualizacion_rpac'
           AND t.estado <> 'cancelado' AND t.created_at >= now() - interval '12 months')
       AND NOT EXISTS (
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

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'ddjj', v_cnt_ddjj, 'curso_actualizacion', v_cnt_curso,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_vencimientos_generados', v_cnt_caba_venc);
END;
$$;
