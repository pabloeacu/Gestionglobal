-- 0642_dgg241_landing_split_servicios_alumnos.sql
-- DGG-241 cont (pedido estético de Pablo 2026-11-03): separar las opiniones en
-- DOS grupos por lugar y estética:
--   • categoria='servicio' → se muestran debajo de "Cómo trabajamos" (opiniones
--     sobre el servicio/gestión; tratamiento petróleo, sin métricas de curso).
--   • categoria='alumno'   → se muestran debajo de "Formate con los mejores"
--     (la voz de los alumnos; tratamiento cian + métricas en vivo de encuestas).
-- El motivo: la mezcla alumnos↔servicios no se distinguía y daba a entender que
-- "lo único que damos es cursos". Además la franja de servicios (fondo claro)
-- queda entre dos secciones oscuras (Cómo trabajamos / Plataforma) y rompe el
-- "dark+dark pegado" que no dejaba identificar dónde empieza y termina cada una.
--
-- 100% aditivo: no cambia el comportamiento de la landing (fetch, carrusel,
-- métricas, SEO). Sólo agrega la dimensión `categoria` + un segundo título.
-- Reglas: R6 (GRANT ya existente en la tabla), R16 (DROP antes de CREATE en
-- TODA RPC pública extendida), R8 (naming: columna nueva en inglés de dominio
-- consistente con el resto de landing_*).

-- ============================================================================
-- 1. Dimensión `categoria` en las cards
-- ============================================================================
ALTER TABLE public.landing_testimonios
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'alumno';

ALTER TABLE public.landing_testimonios
  DROP CONSTRAINT IF EXISTS landing_testimonios_categoria_chk;
ALTER TABLE public.landing_testimonios
  ADD CONSTRAINT landing_testimonios_categoria_chk
  CHECK (categoria IN ('servicio','alumno'));

COMMENT ON COLUMN public.landing_testimonios.categoria IS
  'DGG-241 · dónde se muestra la card: servicio (debajo de "Cómo trabajamos") | alumno (debajo de "Formate con los mejores"). Las de encuesta son siempre alumno.';

-- índice para el filtro por sección (la landing lee por RPC, pero el write-path
-- y futuros conteos por categoría lo aprovechan). R11.
CREATE INDEX IF NOT EXISTS idx_landing_testimonios_cat_orden
  ON public.landing_testimonios (categoria, activo, orden);

-- backfill de las 2 cards legacy que son opiniones de SERVICIO (la de Vanesa
-- Agote habla de "las clases, el contenido" → queda como alumno por default).
UPDATE public.landing_testimonios
   SET categoria = 'servicio'
 WHERE origen = 'manual' AND respuesta_id IS NULL
   AND nombre IN ('Olga Romero Núñez', 'Julio Ariel Fernández');

-- ============================================================================
-- 2. Segundo título (sección de servicios) — editable por gerencia
-- ============================================================================
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS landing_opiniones_titulo_servicios text NOT NULL
      DEFAULT 'La palabra de quienes confían su gestión en nosotros';

COMMENT ON COLUMN public.config_global.landing_opiniones_titulo_servicios IS
  'DGG-241 · título de la franja de opiniones de servicios (debajo de "Cómo trabajamos").';

-- ============================================================================
-- 3. RPC pública (ANON) — ahora expone `categoria` por card + `titulo_servicios`
--    (R16: DROP antes de CREATE; no cambia la cantidad de params pero sí la
--     mantenemos con el patrón para no dejar overloads nunca).
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_opiniones_publicas();
CREATE FUNCTION public.landing_opiniones_publicas() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_titulo text; v_titulo_serv text; v_activa boolean; v_metricas jsonb;
  v_estrellas numeric; v_escala numeric; v_total integer; v_pub integer; v_rating_count integer;
  v_cards jsonb; v_metricas_out jsonb;
BEGIN
  SELECT landing_opiniones_titulo, landing_opiniones_titulo_servicios,
         landing_opiniones_activa, landing_opiniones_metricas
    INTO v_titulo, v_titulo_serv, v_activa, v_metricas
    FROM public.config_global WHERE id = 1;

  -- A#3 (0640): si la sección está apagada, NO servir datos a anon.
  IF NOT COALESCE(v_activa, true) THEN
    RETURN jsonb_build_object('activa', false, 'titulo', v_titulo,
      'titulo_servicios', v_titulo_serv, 'metricas', '[]'::jsonb, 'cards', '[]'::jsonb,
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

  -- todas las cards activas, cada una con su categoría; el front las parte.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', t.nombre, 'comentario', t.comentario, 'foto_url', t.foto_url,
      'curso', t.curso_titulo, 'estrellas', t.estrellas, 'categoria', t.categoria
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
    'activa', COALESCE(v_activa, true),
    'titulo', v_titulo, 'titulo_servicios', v_titulo_serv,
    'metricas', v_metricas_out, 'cards', v_cards,
    'agg', jsonb_build_object('rating', v_estrellas, 'count', COALESCE(v_rating_count, 0)));
END; $$;
REVOKE ALL ON FUNCTION public.landing_opiniones_publicas() FROM public;
GRANT EXECUTE ON FUNCTION public.landing_opiniones_publicas() TO anon, authenticated, service_role;

-- ============================================================================
-- 4. RPC admin (staff) — expone `categoria` por card + `titulo_servicios`
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_opiniones_admin();
CREATE FUNCTION public.landing_opiniones_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_titulo text; v_titulo_serv text; v_activa boolean; v_metricas jsonb; v_cards jsonb; v_pool jsonb;
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT landing_opiniones_titulo, landing_opiniones_titulo_servicios,
         landing_opiniones_activa, landing_opiniones_metricas
    INTO v_titulo, v_titulo_serv, v_activa, v_metricas FROM public.config_global WHERE id=1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id, 'respuesta_id', t.respuesta_id, 'nombre', t.nombre, 'comentario', t.comentario,
      'foto_url', t.foto_url, 'curso', t.curso_titulo, 'estrellas', t.estrellas,
      'orden', t.orden, 'activo', t.activo, 'origen', t.origen, 'categoria', t.categoria
    ) ORDER BY t.orden, t.created_at), '[]'::jsonb)
    INTO v_cards FROM public.landing_testimonios t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'respuesta_id', r.id, 'nombre', COALESCE(r.testimonio_nombre, pr.full_name, 'Alumno'),
      'comentario', r.testimonio_comentario, 'foto_url', r.testimonio_foto_url,
      'curso', c.titulo, 'fecha', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_pool
  FROM public.curso_encuesta_respuestas r
  JOIN public.curso_encuestas e ON e.id = r.encuesta_id
  LEFT JOIN public.cursos c ON c.id = e.curso_id
  LEFT JOIN public.curso_matriculas m ON m.id = r.matricula_id
  LEFT JOIN public.profiles pr ON pr.id = m.profile_id
  WHERE r.permite_publicar
    AND COALESCE(btrim(r.testimonio_comentario),'') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.landing_testimonios lt WHERE lt.respuesta_id = r.id);

  RETURN jsonb_build_object('titulo', v_titulo, 'titulo_servicios', v_titulo_serv,
    'activa', v_activa, 'metricas', v_metricas, 'cards', v_cards, 'pool', v_pool);
END; $$;
REVOKE ALL ON FUNCTION public.landing_opiniones_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_opiniones_admin() TO authenticated, service_role;

-- ============================================================================
-- 5. Curaduría: las de encuesta son SIEMPRE alumno; la manual elige categoría.
-- ============================================================================
-- agregar desde publicable → categoria='alumno' explícito.
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
  INSERT INTO public.landing_testimonios (respuesta_id, nombre, comentario, foto_url, curso_titulo, estrellas, orden, origen, categoria, created_by)
  VALUES (p_respuesta_id, v_nombre, btrim(r.testimonio_comentario), r.testimonio_foto_url, v_curso, v_estrellas,
          COALESCE((SELECT max(orden)+1 FROM public.landing_testimonios), 0), 'encuesta', 'alumno', auth.uid())
  ON CONFLICT (respuesta_id) WHERE respuesta_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ya_cardeada'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_agregar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_agregar(uuid) TO authenticated, service_role;

-- agregar manual → nuevo param p_categoria (R16: DROP firmas viejas Y la nueva).
DROP FUNCTION IF EXISTS public.landing_testimonio_manual(text, text, text, text);
DROP FUNCTION IF EXISTS public.landing_testimonio_manual(text, text, text, text, text);
CREATE FUNCTION public.landing_testimonio_manual(
  p_nombre text, p_comentario text, p_curso text DEFAULT NULL,
  p_foto_url text DEFAULT NULL, p_categoria text DEFAULT 'alumno'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_cat text;
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF COALESCE(btrim(p_nombre),'')='' OR COALESCE(btrim(p_comentario),'')='' THEN RAISE EXCEPTION 'nombre y comentario requeridos'; END IF;
  v_cat := CASE WHEN p_categoria = 'servicio' THEN 'servicio' ELSE 'alumno' END;
  INSERT INTO public.landing_testimonios (nombre, comentario, curso_titulo, foto_url, orden, origen, categoria, created_by)
  VALUES (btrim(p_nombre), btrim(p_comentario), NULLIF(btrim(COALESCE(p_curso,'')),''), NULLIF(btrim(COALESCE(p_foto_url,'')),''),
          COALESCE((SELECT max(orden)+1 FROM public.landing_testimonios), 0), 'manual', v_cat, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_manual(text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_manual(text, text, text, text, text) TO authenticated, service_role;
