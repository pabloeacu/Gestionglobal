-- 0640_dgg241_fixes_s6_landing.sql
-- DGG-241 · fixes de la doble auditoría §6 (3 agentes) de "La voz de los alumnos".
--   • métricas: NULL → '—' (no "0.0/5" engañoso en la web). [A#1]
--   • activa=false realmente CORTA el payload a anon (no sólo el render). [A#3]
--   • "publicable" unificado: el trigger +20 y la métrica `publicables` cuentan
--     con comentario no vacío = lo accionable del pool (aviso == trabajo real). [A#4/C#1]
--   • agg.count (ratingCount SEO) = respuestas que realmente puntuaron estrellas,
--     no count(*) total (schema.org coherente). [C#4]
--   • trigger: best-effort (EXCEPTION → nunca tumba el submit del alumno) [A#6],
--     FOR UPDATE del singleton (sin doble aviso) [C#5], resync del contador si
--     el count baja [A#5], url del aviso → ?tab=landing [C#6].
--   • agregar: si ya estaba cardeada, {ok:false, ya_cardeada} (feedback claro). [A#9]
--   • índice parcial en permite_publicar (R11, el RPC anon y el write-path cuentan). [A#7]
-- R16: DROP antes de CREATE. Aditivo; no toca DGG-240.

-- A#7 · índice parcial (count de publicables en el RPC anon + en el write-path)
CREATE INDEX IF NOT EXISTS idx_cer_permite_publicar
  ON public.curso_encuesta_respuestas (permite_publicar) WHERE permite_publicar;

-- ============================================================================
-- RPC pública (anon) — A#1 (null→'—'), A#3 (activa corta payload), C#4 (ratingCount), publicables con comentario
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_opiniones_publicas();
CREATE FUNCTION public.landing_opiniones_publicas() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_titulo text; v_activa boolean; v_metricas jsonb;
  v_estrellas numeric; v_escala numeric; v_total integer; v_pub integer; v_rating_count integer;
  v_cards jsonb; v_metricas_out jsonb;
BEGIN
  SELECT landing_opiniones_titulo, landing_opiniones_activa, landing_opiniones_metricas
    INTO v_titulo, v_activa, v_metricas FROM public.config_global WHERE id = 1;

  -- A#3: si la sección está apagada, NO servir datos a anon.
  IF NOT COALESCE(v_activa, true) THEN
    RETURN jsonb_build_object('activa', false, 'titulo', v_titulo,
      'metricas', '[]'::jsonb, 'cards', '[]'::jsonb,
      'agg', jsonb_build_object('rating', NULL, 'count', 0));
  END IF;

  WITH vals AS (
    SELECT r.id, (r.respuestas->>(pq->>'id'))::numeric AS v, pq->>'tipo' AS tipo
    FROM public.curso_encuesta_respuestas r
    JOIN public.curso_encuestas e ON e.id = r.encuesta_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.schema->'preguntas','[]'::jsonb)) AS pq
    WHERE pq->>'tipo' IN ('estrellas','escala_10')
      AND r.respuestas ? (pq->>'id')
      AND jsonb_typeof(r.respuestas->(pq->>'id')) = 'number'
  )
  SELECT round(avg(v) FILTER (WHERE tipo='estrellas'), 1),
         round(avg(v) FILTER (WHERE tipo='escala_10'), 1),
         count(DISTINCT id) FILTER (WHERE tipo='estrellas')
    INTO v_estrellas, v_escala, v_rating_count FROM vals;
  SELECT count(*) INTO v_total FROM public.curso_encuesta_respuestas;
  -- publicables = lo que puede ser card (con comentario), coherente con el pool/aviso
  SELECT count(*) INTO v_pub FROM public.curso_encuesta_respuestas
    WHERE permite_publicar AND btrim(COALESCE(testimonio_comentario,'')) <> '';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', t.nombre, 'comentario', t.comentario, 'foto_url', t.foto_url,
      'curso', t.curso_titulo, 'estrellas', t.estrellas
    ) ORDER BY t.orden, t.created_at), '[]'::jsonb)
    INTO v_cards FROM public.landing_testimonios t WHERE t.activo;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'label', m->>'label', 'sufijo', COALESCE(m->>'sufijo',''),
      'valor', CASE m->>'kind'
        WHEN 'estrellas_global' THEN CASE WHEN v_estrellas IS NULL THEN '—' ELSE to_char(v_estrellas,'FM999990.0') END
        WHEN 'escala_global'    THEN CASE WHEN v_escala IS NULL THEN '—' ELSE to_char(v_escala,'FM999990.0') END
        WHEN 'opiniones'        THEN v_total::text
        WHEN 'publicables'      THEN v_pub::text
        WHEN 'manual'           THEN COALESCE(m->>'valor','')
        ELSE '' END
    ) ORDER BY ord), '[]'::jsonb)
    INTO v_metricas_out
  FROM jsonb_array_elements(COALESCE(v_metricas,'[]'::jsonb)) WITH ORDINALITY AS x(m, ord);

  RETURN jsonb_build_object(
    'activa', jsonb_array_length(v_cards) > 0,
    'titulo', v_titulo, 'metricas', v_metricas_out, 'cards', v_cards,
    'agg', jsonb_build_object('rating', v_estrellas, 'count', COALESCE(v_rating_count, 0)));
END; $$;
REVOKE ALL ON FUNCTION public.landing_opiniones_publicas() FROM public;
GRANT EXECUTE ON FUNCTION public.landing_opiniones_publicas() TO anon, authenticated, service_role;

-- ============================================================================
-- agregar — A#9: feedback claro si ya estaba cardeada
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_testimonio_agregar(uuid);
CREATE FUNCTION public.landing_testimonio_agregar(p_respuesta_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.curso_encuesta_respuestas%ROWTYPE; v_sch jsonb; v_nombre text; v_curso text; v_estrellas numeric; v_id uuid;
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.curso_encuesta_respuestas WHERE id = p_respuesta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'respuesta inexistente'; END IF;
  IF NOT r.permite_publicar THEN RAISE EXCEPTION 'el alumno no autorizó a publicar esta respuesta'; END IF;
  IF COALESCE(btrim(r.testimonio_comentario),'') = '' THEN RAISE EXCEPTION 'la respuesta no tiene comentario'; END IF;
  SELECT e.schema, c.titulo INTO v_sch, v_curso
  FROM public.curso_encuestas e LEFT JOIN public.cursos c ON c.id=e.curso_id WHERE e.id = r.encuesta_id;
  SELECT COALESCE(r.testimonio_nombre, pr.full_name, 'Alumno') INTO v_nombre
  FROM public.curso_matriculas m LEFT JOIN public.profiles pr ON pr.id=m.profile_id WHERE m.id = r.matricula_id;
  IF v_nombre IS NULL THEN v_nombre := COALESCE(r.testimonio_nombre, 'Alumno'); END IF;
  SELECT round(avg((r.respuestas->>(pq->>'id'))::numeric),1) INTO v_estrellas
  FROM jsonb_array_elements(COALESCE(v_sch->'preguntas','[]'::jsonb)) pq
  WHERE pq->>'tipo'='estrellas' AND r.respuestas ? (pq->>'id')
    AND jsonb_typeof(r.respuestas->(pq->>'id'))='number';
  INSERT INTO public.landing_testimonios (respuesta_id, nombre, comentario, foto_url, curso_titulo, estrellas, orden, origen, created_by)
  VALUES (p_respuesta_id, v_nombre, btrim(r.testimonio_comentario), r.testimonio_foto_url, v_curso, v_estrellas,
          COALESCE((SELECT max(orden)+1 FROM public.landing_testimonios), 0), 'encuesta', auth.uid())
  ON CONFLICT (respuesta_id) WHERE respuesta_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ya_cardeada'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_agregar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_agregar(uuid) TO authenticated, service_role;

-- ============================================================================
-- trigger +20 — A#4/C#1 (comentario), A#5 (resync), A#6 (best-effort), C#5 (FOR UPDATE), C#6 (?tab=landing)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.landing_opiniones_notif_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer; v_ultimo integer; v_ger record; v_cuerpo text;
BEGIN
  IF NOT COALESCE(NEW.permite_publicar, false) THEN RETURN NEW; END IF;
  -- Best-effort: el aviso de la landing NUNCA debe tumbar el submit del alumno.
  BEGIN
    SELECT landing_opiniones_ultimo_notif INTO v_ultimo FROM public.config_global WHERE id = 1 FOR UPDATE;
    -- publicables ACCIONABLES (con comentario) = lo que el gerente verá en el pool
    SELECT count(*) INTO v_count FROM public.curso_encuesta_respuestas
      WHERE permite_publicar AND btrim(COALESCE(testimonio_comentario,'')) <> '';
    IF v_count < COALESCE(v_ultimo, 0) THEN
      UPDATE public.config_global SET landing_opiniones_ultimo_notif = v_count WHERE id = 1;  -- resync hacia abajo
      RETURN NEW;
    END IF;
    IF v_count - COALESCE(v_ultimo, 0) < 20 THEN RETURN NEW; END IF;
    v_cuerpo := 'Hay ' || v_count || ' opiniones publicables con comentario acumuladas (antes avisamos en ' || COALESCE(v_ultimo,0)
      || '). Entrá a Configuración → Encuestas · Envío al CM → Sección de la landing para revisar y actualizar las opiniones destacadas de la web.';
    FOR v_ger IN
      SELECT u.email, COALESCE(p.full_name,'Gerencia') AS nombre
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
      WHERE p.role = 'gerente' AND p.activo = true AND u.email IS NOT NULL
    LOOP
      INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, related_table, programado_para)
      VALUES ('workflow', 'gerencia-notif-generica', v_ger.email, v_ger.nombre,
              jsonb_build_object('titulo_evento','Nuevas opiniones para la landing','cuerpo',v_cuerpo,
                                 'url','/gerencia/configuracion/encuestas-cm?tab=landing'), 5, 'landing_testimonios', now());
    END LOOP;
    UPDATE public.config_global SET landing_opiniones_ultimo_notif = v_count WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;  -- nunca romper la respuesta del alumno por un fallo del aviso
  END;
  RETURN NEW;
END; $$;
