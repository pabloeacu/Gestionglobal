-- 0641_dgg241_landing_metricas_kind_hint.sql
-- DGG-241 cont (pulido estético): la RPC pública expone `kind` + `hint` por
-- métrica para que la landing elija la viz (estrellas/barra/ícono) y muestre la
-- aclaración ("del último cuatrimestre" en el conteo, porque hay +300 alumnos
-- en total y acá se recopila lo más reciente). Default de métricas gana `hint`.

ALTER TABLE public.config_global ALTER COLUMN landing_opiniones_metricas SET DEFAULT
  '[{"id":"estrellas","label":"Calidad general","kind":"estrellas_global","sufijo":"/5","hint":""},
    {"id":"satisfaccion","label":"Satisfacción","kind":"escala_global","sufijo":"/10","hint":""},
    {"id":"opiniones","label":"Opiniones de alumnos","kind":"opiniones","sufijo":"","hint":"del último cuatrimestre"}]'::jsonb;

UPDATE public.config_global SET landing_opiniones_metricas =
  '[{"id":"estrellas","label":"Calidad general","kind":"estrellas_global","sufijo":"/5","hint":""},
    {"id":"satisfaccion","label":"Satisfacción","kind":"escala_global","sufijo":"/10","hint":""},
    {"id":"opiniones","label":"Opiniones de alumnos","kind":"opiniones","sufijo":"","hint":"del último cuatrimestre"}]'::jsonb
WHERE id = 1;

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
  SELECT count(*) INTO v_pub FROM public.curso_encuesta_respuestas
    WHERE permite_publicar AND btrim(COALESCE(testimonio_comentario,'')) <> '';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', t.nombre, 'comentario', t.comentario, 'foto_url', t.foto_url,
      'curso', t.curso_titulo, 'estrellas', t.estrellas
    ) ORDER BY t.orden, t.created_at), '[]'::jsonb)
    INTO v_cards FROM public.landing_testimonios t WHERE t.activo;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'label', m->>'label', 'sufijo', COALESCE(m->>'sufijo',''),
      'kind', m->>'kind', 'hint', COALESCE(m->>'hint',''),
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
