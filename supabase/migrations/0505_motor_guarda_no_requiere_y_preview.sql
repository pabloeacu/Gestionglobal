-- 0505 · Agenda · (1) guarda `no_requiere` en el motor de ofrecimientos + (2) preview por-admin.
--
-- CONTEXTO: `gg_ofrecimientos_diario` (motor de cross-sell, DORMIDO) es anterior al form del
-- cliente (DGG-197). Ignora el opt-out "no requiero X". Este cambio:
--   (a) Extrae la ELEGIBILIDAD de negocio de cada cadencia a un helper ÚNICO
--       `private.gg_ofrecimiento_elegible(admin, regla, hoy)` — fuente de verdad compartida por
--       el motor Y por el preview, para que el panorama al cierre coincida EXACTO con lo que el
--       motor haría (consistencia absoluta, sin drift). El helper agrega la guarda `no_requiere`.
--   (b) Refactoriza el §2 del motor para llamar al helper (mantiene idénticos §0 CABA, §1
--       capacitación, cap 40/día, gracia 7d, cooldowns por-regla y el log). Sin cambios de
--       comportamiento salvo el nuevo respeto al opt-out.
--   (c) Agrega `public.gg_ofrecimientos_preview(admin)` (SOLO LECTURA, R12) para la UI.
-- El motor SIGUE DORMIDO (sin cron): esto no envía nada. Mapeo opt-out→regla:
--   ddjj→ddjj_ciclo · curso_actualizacion→curso_actualizacion_60 · certificado→certificado_90 · consultoria→cj_120.

-- ── (a) helper de elegibilidad de negocio (predicados + guarda no_requiere; SIN cooldowns) ──
CREATE OR REPLACE FUNCTION private.gg_ofrecimiento_elegible(p_admin uuid, p_regla text, p_hoy date)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_regla
    WHEN 'ddjj_ciclo' THEN
      EXTRACT(MONTH FROM p_hoy)::int IN (11,12,1,2,3)
      AND private.gg_admin_es_rpac(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_ddjj' AND t.estado<>'cancelado'
          AND t.created_at >= make_date(EXTRACT(YEAR FROM p_hoy)::int - CASE WHEN EXTRACT(MONTH FROM p_hoy)>=11 THEN 0 ELSE 1 END, 11, 1))
      AND NOT COALESCE((SELECT pr.no_requiere ? 'ddjj' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'curso_actualizacion_60' THEN
      private.gg_admin_es_rpac(p_admin) AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado='cerrado' AND t.cierre_satisfactorio IS DISTINCT FROM false
          AND COALESCE(t.fecha_fin::timestamptz, t.resuelto_at) >= now() - interval '60 days')
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='curso_actualizacion_rpac' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '12 months')
      AND NOT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id=cm.curso_id LEFT JOIN public.profiles p ON p.id=cm.profile_id
        WHERE COALESCE(cm.administracion_id,p.administracion_id)=p_admin AND cm.estado<>'anulada' AND c.jurisdiccion='pba' AND c.slug ILIKE '%actualizacion%' AND cm.inscripto_at >= now() - interval '12 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'curso_actualizacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'certificado_90' THEN
      private.gg_admin_es_rpac(p_admin) AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_certificado' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '90 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'certificado' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'cj_120' THEN
      (private.gg_admin_es_rpac(p_admin) OR private.gg_admin_hizo_curso_caba(p_admin))
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='juridico_consulta' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '120 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'consultoria' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    ELSE false
  END;
$fn$;

-- ── (b) motor refactorizado: §2 llama al helper; §0/§1/cap/gracia/cooldowns IDÉNTICOS ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_diario()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
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
BEGIN
  -- ── 0 · Riel CABA (siembra fila vencimientos 30/15/0). Idéntico.
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

  -- ── 1 · Capacitación gratuita PRIMERO (one-shot time-critical). Idéntico (sin opt-out: es gratis).
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

  -- ── 2 · Cadencias móviles (elegibilidad por helper compartido + cooldown por-regla).
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id,
           COALESCE(NULLIF(trim(concat_ws(' ', a.responsable_nombre, a.responsable_apellido)), ''), a.nombre) AS contacto
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados
      AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;

    -- gracia: tocado en los últimos 7 días → esperar.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.ofrecimientos_log ol
      WHERE ol.administracion_id = v_admin.id AND ol.ciclo_ancla >= v_hoy - 7);

    v_regla := NULL;

    IF private.gg_ofrecimiento_elegible(v_admin.id, 'ddjj_ciclo', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'ddjj_ciclo'
           AND ol.enviado_at >= (v_hoy - 30)::timestamptz)
    THEN
      v_regla := 'ddjj_ciclo';

    ELSIF private.gg_ofrecimiento_elegible(v_admin.id, 'curso_actualizacion_60', v_hoy)
       AND NOT EXISTS (
         SELECT 1 FROM public.ofrecimientos_log ol
         WHERE ol.administracion_id = v_admin.id AND ol.codigo = 'curso_actualizacion_60'
           AND ol.enviado_at >= (v_hoy - 60)::timestamptz)
    THEN
      v_regla := 'curso_actualizacion_60';

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
$function$;

-- ── (c) preview por-admin (SOLO LECTURA, R12) para el panorama al cierre ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_preview(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp' SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  d record;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12
  SELECT no_requiere INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'certificado', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'certificado_90',v_hoy),
      'no_requiere', COALESCE(d.no_requiere ? 'certificado', false)),
    'consultoria', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'cj_120',v_hoy),
      'no_requiere', COALESCE(d.no_requiere ? 'consultoria', false)),
    'curso_actualizacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'curso_actualizacion_60',v_hoy),
      'no_requiere', COALESCE(d.no_requiere ? 'curso_actualizacion', false)),
    'ddjj', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'ddjj_ciclo',v_hoy),
      'no_requiere', COALESCE(d.no_requiere ? 'ddjj', false))
  );
END $fn$;
REVOKE ALL ON FUNCTION public.gg_ofrecimientos_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gg_ofrecimientos_preview(uuid) TO authenticated;
