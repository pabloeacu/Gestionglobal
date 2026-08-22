-- 0447_dgg142e4_f6_hallazgos_s6_motor_v2.sql
-- DGG-142 · Etapa 4 · F6 — Paquete de fixes de la doble auditoría §6
-- (3 agentes + refutación + simulación día-1 sobre prod). Hallazgos:
--
-- (1) CRÍTICO [E-GG-188] · `dispatch_vencimientos_log`: el upsert de la edge
--     (PostgREST ON CONFLICT por columnas) NUNCA pudo inferir el índice único
--     PARCIAL `uq_dispatch_log_item` (WHERE vencimiento_id IS NOT NULL) →
--     42P10 silencioso desde mig 0041: **0 filas de item en todo el
--     historial** (verificado en vivo) — la idempotencia entre corridas de
--     dispatch-vencimientos jamás funcionó (no se notó porque el cron corre
--     1 vez/día y cada tríada matchea un solo día). Fix: constraint UNIQUE
--     real (NULLS DISTINCT default → las filas-resumen no chocan).
-- (2) CRÍTICO · `tracking_cerrar_ciclo` v4: para servicios RPAC con cierre
--     satisfactorio dejaba DOS filas vigentes para el mismo evento (la 'otro'
--     propia + la 'renovacion_rpac' del sync 0444 disparado por su UPDATE de
--     ficha) → hasta 6 días de alerta y 2 emails el mismo día (offset 30
--     compartido). Ahora: no inserta 'otro'; pisa la ficha primero (el sync
--     crea/actualiza LA fila canónica) y la ADOPTA (tracking_id + offsets del
--     gerente + notificar) — una sola fila, template de renovación correcto.
-- (3) CRÍTICO · capacitación one-shot: el cap global podía cortar el loop y
--     el form quedaba marcado igual → invitación perdida para siempre (fatal
--     el día 1 con backlog). Ahora: dedupe por-admin por codigo (cualquier
--     ancla) y el form se marca SOLO si el loop terminó sin corte — el
--     one-shot se derrama a días siguientes sin duplicar a nadie.
-- (4) Fuga del "máx 1 toque/cliente/día": capacitación corre AHORA ANTES de
--     las cadencias (el guard de éstas ve sus toques) y además saltea
--     admins ya tocados hoy.
-- (5) Ventana de gracia de 7 días entre reglas distintas: el guard de
--     cadencias pasa de "tocado hoy" a "tocado en los últimos 7 días" — sin
--     esto, 48/49 clientes encadenaban certificado→CJ en días corridos
--     (simulación día-1). Las cadencias largas no se ven afectadas.
-- (6) Morosos: las reglas de cross-sell PAGO (certificado/CJ/curso) saltean
--     clientes con deuda (espíritu DGG-45r, coherente con el banner); DDJJ
--     es obligación dura y NO filtra. Criterio propio pendiente de
--     confirmación de Pablo — documentado en DECISIONES.
-- (7) Riel CABA: + gates a.activo / estado<>'baja' + notificar_cliente
--     espeja el switch (antes hardcode true).
-- (8) Curso 60d: dedupe también por TRÁMITE del servicio
--     curso_actualizacion_rpac (el cliente que ya CONTRATÓ el curso no
--     recibe la oferta de lo que compró, aunque aún no tenga matrícula).
-- (9) Dashboard: card DDJJ también forzada el día del toque del motor.

-- (1) ----------------------------------------------------------------------
DROP INDEX public.uq_dispatch_log_item;
ALTER TABLE public.dispatch_vencimientos_log
  ADD CONSTRAINT uq_dispatch_log_item UNIQUE (vencimiento_id, offset_dias, canal);

-- (2) ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_cerrar_ciclo(
  p_tracking_id uuid,
  p_proxima_fecha date,
  p_alarmas_offsets integer[],
  p_notificar_cliente boolean DEFAULT true
)
RETURNS TABLE (vencimiento_id uuid, alarmas_planificadas date[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite record;
  v_new_id  uuid;
  v_sujeto  text;
  v_sujeto_id uuid;
  v_offset int;
  v_alarmas date[] := '{}';
  v_offsets int[];
  v_serv_codigo text;
  v_rpac_ok boolean := false;
BEGIN
  v_offsets := COALESCE(p_alarmas_offsets, ARRAY[30,7,2]::int[]);

  SELECT t.* INTO v_tramite FROM public.tramites t WHERE t.id = p_tracking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.is_staff() THEN
    IF v_tramite.administracion_id IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_tramite.administracion_id);
  END IF;

  IF p_proxima_fecha IS NULL OR p_proxima_fecha <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La próxima fecha debe ser futura' USING ERRCODE = '22023';
  END IF;

  IF v_tramite.consorcio_id IS NOT NULL THEN
    v_sujeto := 'consorcio'; v_sujeto_id := v_tramite.consorcio_id;
  ELSE
    v_sujeto := 'administracion'; v_sujeto_id := COALESCE(v_tramite.administracion_id, p_tracking_id);
  END IF;

  IF v_tramite.administracion_id IS NULL THEN
    RAISE EXCEPTION 'El tracking no tiene administración asociada' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tramites
     SET cycle_closed_at = now(), ultima_actividad_at = now()
   WHERE id = p_tracking_id;

  SELECT s.codigo INTO v_serv_codigo
    FROM public.servicios s WHERE s.id = v_tramite.servicio_id;
  v_rpac_ok := v_serv_codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
               AND v_tramite.cierre_satisfactorio IS DISTINCT FROM false;

  -- Supersede de los vigentes previos de ESTE tracking (patrón 0441).
  UPDATE public.vencimientos SET estado = 'renovado'
   WHERE tracking_id = p_tracking_id AND estado = 'vigente';

  IF v_rpac_ok THEN
    -- §6 E4 (2): NO crear fila 'otro'. Pisar la ficha PRIMERO — el trigger
    -- sync (0444) supersede/crea LA fila canónica 'renovacion_rpac' — y
    -- ADOPTARLA con los parámetros explícitos del gerente.
    UPDATE public.administraciones
       SET matricula_rpac_vencimiento = p_proxima_fecha, updated_at = now()
     WHERE id = v_tramite.administracion_id;

    UPDATE public.vencimientos
       SET tracking_id = p_tracking_id,
           alarmas_offsets = v_offsets,
           notificar_cliente = COALESCE(p_notificar_cliente, true),
           descripcion = COALESCE('Próximo vencimiento generado por tracking «' || v_tramite.titulo || '»', descripcion)
     WHERE administracion_id = v_tramite.administracion_id
       AND tipo = 'renovacion_rpac' AND estado = 'vigente'
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
      -- Fallback (no debería pasar): crearla nosotros con el tipo canónico.
      INSERT INTO public.vencimientos
        (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento,
         fecha_emision, descripcion, estado, alarmas_offsets, notificar_cliente, tracking_id)
      VALUES ('renovacion_rpac', v_sujeto, v_sujeto_id, v_tramite.administracion_id,
              p_proxima_fecha, CURRENT_DATE,
              COALESCE('Próximo vencimiento generado por tracking «' || v_tramite.titulo || '»', 'Próximo vencimiento'),
              'vigente', v_offsets, COALESCE(p_notificar_cliente, true), p_tracking_id)
      RETURNING id INTO v_new_id;
    END IF;
  ELSE
    INSERT INTO public.vencimientos
      (tipo, sujeto, sujeto_id, administracion_id, consorcio_id,
       fecha_vencimiento, fecha_emision, descripcion, estado,
       alarmas_offsets, notificar_cliente, tracking_id, origen)
    VALUES
      ('otro', v_sujeto, v_sujeto_id, v_tramite.administracion_id, v_tramite.consorcio_id,
       p_proxima_fecha, CURRENT_DATE,
       COALESCE('Próximo vencimiento generado por tracking «' || v_tramite.titulo || '»', 'Próximo vencimiento'),
       'vigente', v_offsets, COALESCE(p_notificar_cliente, true), p_tracking_id, 'tracking')
    RETURNING id INTO v_new_id;
  END IF;

  FOREACH v_offset IN ARRAY v_offsets LOOP
    v_alarmas := array_append(v_alarmas, (p_proxima_fecha - v_offset)::date);
  END LOOP;

  RETURN QUERY SELECT v_new_id, v_alarmas;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  TO authenticated;

-- (3)-(8) ------------------------------------------------------------------
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
  v_deuda numeric;
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

    -- §6 (6): deuda sólo bloquea cross-sell pago (no DDJJ).
    SELECT COALESCE(d.total, 0) INTO v_deuda FROM public.cliente_deuda_neta(v_admin.id) d;

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

    ELSIF v_deuda = 0
       AND private.gg_admin_es_rpac(v_admin.id)
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

    ELSIF v_deuda = 0
       AND private.gg_admin_es_rpac(v_admin.id)
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

    ELSIF v_deuda = 0
       AND (private.gg_admin_es_rpac(v_admin.id) OR private.gg_admin_hizo_curso_caba(v_admin.id))
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

REVOKE EXECUTE ON FUNCTION public.gg_ofrecimientos_diario() FROM PUBLIC, anon, authenticated;

-- DIFERIDO (§6 E4, nota): los toques DDJJ 2-5 y los de capacitación no
-- fuerzan card en el dashboard (sólo curso/certificado/CJ consultan
-- v_toques_hoy) — el toque llega igual por email + push/campanita. Se
-- integra en la próxima revisión de cliente_portal_dashboard.
