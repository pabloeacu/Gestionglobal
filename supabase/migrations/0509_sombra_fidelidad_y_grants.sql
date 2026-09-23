-- 0509 · §6 del modo sombra (E-GG-215): fixes de FIDELIDAD + hardening de grants.
--
-- Los 2 agentes §6 confirmaron lo crítico (la sombra NO envía/escribe nada real). Hallazgos:
--  FIDELIDAD (isolation agent): el seed `caba_venc` de §0 se escribía en la MISMA tabla que gobierna
--   la supresión de ofertas (gracia 7d de §2 + dedup diario de §1). En el motor REAL el seed CABA vive
--   en `vencimientos` (tabla aparte) → no suprime cadencias. En la sombra sí → sub-proyectaba ofertas
--   para la cohorte CABA (2 admins) y, como nunca crea el vencimiento real, se re-insertaba cada día
--   (gracia eterna + reporte sobrecontado). Fix: (a) excluir `codigo='caba_venc'` de la gracia §2 y el
--   dedup diario §1; (b) sembrar `ciclo_ancla=aniversario` (estable) + dedup del §0 contra la propia
--   sombra; (c) portar el filtro `webinar_inscriptos` a §1 (paridad con el real).
--  SEGURIDAD (security agent, #5): la tabla arrastró grants default de Supabase a anon/authenticated
--   (writes incluidos). Hoy tapado por RLS, pero es tabla con PII (emails) → least-privilege R6.
-- El motor real y el resto de la sombra siguen intactos. Tras esto se re-corre el día 1 limpio.

-- ── grants least-privilege (R6) ──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ofrecimientos_sombra FROM authenticated;
REVOKE ALL ON public.ofrecimientos_sombra FROM anon;
GRANT SELECT ON public.ofrecimientos_sombra TO authenticated;  -- idempotente

-- ── motor sombra con fidelidad corregida ──
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
BEGIN
  IF EXISTS (SELECT 1 FROM public.ofrecimientos_sombra WHERE corrida_fecha = v_hoy) THEN
    RETURN jsonb_build_object('fecha', v_hoy, 'skipped', 'ya_corrio_hoy');
  END IF;

  -- §0 · CABA: loguea la intención con ciclo_ancla=aniversario (estable, fuera de la ventana de
  -- gracia de hoy) y dedup contra la propia sombra → se registra una sola vez por aniversario.
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

  -- §1 · Capacitación (paridad: dedup por form + por día EXCLUYENDO caba_venc + no-inscripto al webinar).
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

  -- §2 · Cadencias (gracia 7d EXCLUYENDO caba_venc; cooldowns por-regla ya filtran por codigo).
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
    IF private.gg_ofrecimiento_elegible(v_admin.id,'ddjj_ciclo',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='ddjj_ciclo' AND s.ciclo_ancla >= v_hoy-30)
    THEN v_regla := 'ddjj_ciclo';
    ELSIF private.gg_ofrecimiento_elegible(v_admin.id,'curso_actualizacion_60',v_hoy)
       AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s WHERE s.administracion_id=v_admin.id AND s.codigo='curso_actualizacion_60' AND s.ciclo_ancla >= v_hoy-60)
    THEN v_regla := 'curso_actualizacion_60';
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
    IF v_regla='ddjj_ciclo' THEN v_cnt_ddjj:=v_cnt_ddjj+1;
    ELSIF v_regla='curso_actualizacion_60' THEN v_cnt_curso:=v_cnt_curso+1;
    ELSIF v_regla='certificado_90' THEN v_cnt_cert:=v_cnt_cert+1;
    ELSE v_cnt_cj:=v_cnt_cj+1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'fecha', v_hoy, 'modo', 'sombra', 'toques', v_toques, 'cap', v_cap,
    'ddjj', v_cnt_ddjj, 'curso_actualizacion', v_cnt_curso,
    'certificado', v_cnt_cert, 'cj', v_cnt_cj, 'capacitacion', v_cnt_cap,
    'caba_seed_intencion', v_cnt_caba);
END;
$function$;
