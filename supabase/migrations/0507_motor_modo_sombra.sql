-- 0507 · Agenda · MODO SOMBRA del motor de ofrecimientos (DGG-199).
--
-- Pablo pidió "arrancá en modo sombra": el motor corre a diario pero NO ENVÍA nada — solo
-- registra a quién HABRÍA contactado, con qué oferta y por qué canales. Cero riesgo (ningún
-- mail/push/banner, ninguna fila real en vencimientos, ningún form marcado). En ~2 semanas
-- Pablo mira el log y decide el encendido real con datos, sin apuro.
--
-- Fidelidad: la sombra usa el MISMO helper `private.gg_ofrecimiento_elegible` que el motor real
-- (§2), y replica los filtros de §0/§1. La gracia 7d, los cooldowns por-regla y el cap 40/día se
-- calculan contra la propia tabla `ofrecimientos_sombra` → la simulación día-a-día refleja la
-- curva real (drena la base en ~3 días por el cap, después queda en silencio por gracia+cooldown).
-- El motor real (`gg_ofrecimientos_diario`) NO se toca y sigue dormido.

-- ── tabla-espejo (solo lectura para staff; la escribe la función definer) ──
CREATE TABLE IF NOT EXISTS public.ofrecimientos_sombra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_fecha date NOT NULL,                 -- día de la corrida sombra que lo eligió
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  admin_nombre text,                           -- snapshot para reporte legible
  codigo text NOT NULL,                        -- regla: ddjj_ciclo/curso_actualizacion_60/certificado_90/cj_120/capacitacion:<id>/caba_venc
  ciclo_ancla date NOT NULL,                   -- = corrida_fecha (espeja ofrecimientos_log.ciclo_ancla p/ gracia+cooldown)
  email text,                                  -- destino del mail que habría salido (o NULL si sin email)
  tiene_push boolean NOT NULL DEFAULT false,   -- tiene usuario de portal (habría push)
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ofrecimientos_sombra IS
  'Log del MODO SOMBRA del motor de ofrecimientos: a quién HABRÍA contactado cada día, sin enviar nada (DGG-199).';
CREATE INDEX IF NOT EXISTS idx_ofrec_sombra_admin ON public.ofrecimientos_sombra(administracion_id);  -- R11 (FK)
CREATE INDEX IF NOT EXISTS idx_ofrec_sombra_grace ON public.ofrecimientos_sombra(administracion_id, codigo, ciclo_ancla);

ALTER TABLE public.ofrecimientos_sombra ENABLE ROW LEVEL SECURITY;
-- R6: grant explícito. Solo SELECT para authenticated; la escritura va por la función definer.
GRANT SELECT ON public.ofrecimientos_sombra TO authenticated;
CREATE POLICY ofrec_sombra_staff ON public.ofrecimientos_sombra FOR SELECT TO authenticated
  USING (private.is_staff());

-- ── el motor sombra: mismo targeting que el real, TODO efecto redirigido al log ──
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
  -- Idempotencia por día: si ya corrió hoy, no re-loguear (evita duplicar si el cron se dispara 2 veces).
  IF EXISTS (SELECT 1 FROM public.ofrecimientos_sombra WHERE corrida_fecha = v_hoy) THEN
    RETURN jsonb_build_object('fecha', v_hoy, 'skipped', 'ya_corrio_hoy');
  END IF;

  -- ── §0 · CABA: NO inserta vencimientos reales; loguea la intención (data-seeding, no comm directa) ──
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
  SELECT v_hoy, o.admin_id, a.nombre, 'caba_venc', v_hoy
  FROM objetivo o JOIN public.administraciones a ON a.id=o.admin_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = o.admin_id AND v.tipo = 'curso_rpa_caba'
      AND v.estado = 'vigente' AND v.fecha_vencimiento = o.aniversario);
  GET DIAGNOSTICS v_cnt_caba = ROW_COUNT;

  -- ── §1 · Capacitación gratuita (log-only; NO marca publicado_notificado_at) ──
  FOR v_form IN
    SELECT f.id, f.titulo FROM public.formularios f
    WHERE f.categoria = 'evento' AND f.activo = true AND f.publico = true
      AND f.publicado_notificado_at IS NULL
  LOOP
    v_cap_cut := false;
    FOR v_admin IN
      SELECT a.id, a.nombre, a.email, a.user_id
      FROM public.administraciones a
      WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
        AND (private.gg_admin_es_rpac(a.id) OR private.gg_admin_hizo_curso_caba(a.id))
        AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
          WHERE s.administracion_id = a.id AND s.codigo = 'capacitacion:' || v_form.id::text)
        AND NOT EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
          WHERE s.administracion_id = a.id AND s.ciclo_ancla = v_hoy)
    LOOP
      IF v_toques >= v_cap THEN v_cap_cut := true; EXIT; END IF;
      INSERT INTO public.ofrecimientos_sombra (corrida_fecha, administracion_id, admin_nombre, codigo, ciclo_ancla, email, tiene_push)
      VALUES (v_hoy, v_admin.id, v_admin.nombre, 'capacitacion:' || v_form.id::text, v_hoy,
              NULLIF(trim(v_admin.email),''), v_admin.user_id IS NOT NULL);
      v_toques := v_toques + 1; v_cnt_cap := v_cnt_cap + 1;
    END LOOP;
    -- sombra: NO se marca el formulario (el motor real lo hará cuando se encienda).
  END LOOP;

  -- ── §2 · Cadencias (mismo helper + precedencia; gracia/cooldown contra la tabla sombra) ──
  FOR v_admin IN
    SELECT a.id, a.nombre, a.email, a.user_id
    FROM public.administraciones a
    WHERE a.activo AND a.ofrecimientos_habilitados AND a.estado <> 'baja'
    ORDER BY a.created_at
  LOOP
    EXIT WHEN v_toques >= v_cap;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.ofrecimientos_sombra s
      WHERE s.administracion_id = v_admin.id AND s.ciclo_ancla >= v_hoy - 7);

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
REVOKE ALL ON FUNCTION public.gg_ofrecimientos_diario_sombra() FROM PUBLIC, anon, authenticated;
