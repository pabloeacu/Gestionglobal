-- 0639_dgg241_landing_opiniones.sql
-- DGG-241 · "La voz de los alumnos" en la landing — capitaliza las encuestas
-- publicables de DGG-240 como una sección pública (métricas reales en vivo +
-- carrusel de testimonios curados), con un manager de gerencia y un aviso cada
-- 20 publicables nuevas. 100% aditivo: no toca DGG-240 ni el flag `publicado`.
--
-- Componentes:
--   1. Tabla `landing_testimonios` — SNAPSHOT curado de cada card (nombre/
--      comentario/foto/curso/estrellas + orden/activo/origen). El snapshot
--      sobrevive si la respuesta se edita/borra (la landing no se rompe).
--   2. Config en config_global — titulo, metricas destacadas (jsonb), activa,
--      y el contador para el aviso de 20.
--   3. RPC `landing_opiniones_publicas()` (ANON) — datos de la landing: sólo
--      lo curado + métricas calculadas EN VIVO. Nunca respuestas crudas.
--   4. RPC `landing_opiniones_admin()` (staff) — estado del manager.
--   5. RPCs de curaduría (agregar desde publicable / manual / reordenar).
--   6. Trigger `landing_opiniones_notif_check` — cada +20 publicables, mail a
--      los gerentes (reusa `gerencia-notif-generica`). R17 (SECDEF).
--   7. Seed: las 3 cards legacy (hardcodeadas en LandingPage) + contador.
-- Reglas: R2/R5/R6/R16/R17; consentimiento duro (sólo permite_publicar).

-- ============================================================================
-- 1. Tabla de cards curadas (snapshot)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.landing_testimonios (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  respuesta_id  uuid        REFERENCES public.curso_encuesta_respuestas(id) ON DELETE SET NULL,
  nombre        text        NOT NULL,
  comentario    text        NOT NULL,
  foto_url      text,
  curso_titulo  text,
  estrellas     numeric(3,1),
  orden         integer     NOT NULL DEFAULT 0,
  activo        boolean     NOT NULL DEFAULT true,
  origen        text        NOT NULL DEFAULT 'encuesta',   -- 'encuesta' | 'manual'
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
-- una respuesta no se puede cardear dos veces
CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_testimonios_respuesta
  ON public.landing_testimonios (respuesta_id) WHERE respuesta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_landing_testimonios_orden
  ON public.landing_testimonios (activo, orden);

ALTER TABLE public.landing_testimonios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.landing_testimonios FROM anon, authenticated;
-- R6: GRANT explícito. La landing lee por RPC SECDEF (anon); el staff administra.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_testimonios TO authenticated;
DROP POLICY IF EXISTS landing_testimonios_staff_all ON public.landing_testimonios;
CREATE POLICY landing_testimonios_staff_all ON public.landing_testimonios
  FOR ALL TO authenticated
  USING (private.is_gerente()) WITH CHECK (private.is_gerente());

-- ============================================================================
-- 2. Config en config_global
-- ============================================================================
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS landing_opiniones_titulo text NOT NULL
      DEFAULT 'Lo que piensan los alumnos de nuestras capacitaciones',
  ADD COLUMN IF NOT EXISTS landing_opiniones_activa boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS landing_opiniones_metricas jsonb NOT NULL DEFAULT
      '[{"id":"estrellas","label":"Calidad general","kind":"estrellas_global","sufijo":"/5"},
        {"id":"satisfaccion","label":"Satisfacción","kind":"escala_global","sufijo":"/10"},
        {"id":"opiniones","label":"Opiniones de alumnos","kind":"opiniones","sufijo":""}]'::jsonb,
  ADD COLUMN IF NOT EXISTS landing_opiniones_ultimo_notif integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.config_global.landing_opiniones_metricas IS
  'DGG-241 · métricas destacadas de la sección [{id,label,kind,sufijo,valor?}]. kind: estrellas_global|escala_global|opiniones|publicables|manual.';
COMMENT ON COLUMN public.config_global.landing_opiniones_ultimo_notif IS
  'DGG-241 · nivel de publicables al último aviso a gerencia (umbral +20).';

-- ============================================================================
-- 3. RPC pública (ANON) — datos de la landing
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_opiniones_publicas();
CREATE FUNCTION public.landing_opiniones_publicas() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_titulo text; v_activa boolean; v_metricas jsonb;
  v_estrellas numeric; v_escala numeric; v_total integer; v_pub integer;
  v_cards jsonb; v_metricas_out jsonb;
BEGIN
  SELECT landing_opiniones_titulo, landing_opiniones_activa, landing_opiniones_metricas
    INTO v_titulo, v_activa, v_metricas FROM public.config_global WHERE id = 1;

  -- Promedios EN VIVO (todas las preguntas estrellas/escala de todas las encuestas).
  WITH vals AS (
    SELECT (r.respuestas->>(pq->>'id'))::numeric AS v, pq->>'tipo' AS tipo
    FROM public.curso_encuesta_respuestas r
    JOIN public.curso_encuestas e ON e.id = r.encuesta_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.schema->'preguntas','[]'::jsonb)) AS pq
    WHERE pq->>'tipo' IN ('estrellas','escala_10')
      AND r.respuestas ? (pq->>'id')
      AND jsonb_typeof(r.respuestas->(pq->>'id')) = 'number'
  )
  SELECT round(avg(v) FILTER (WHERE tipo='estrellas'), 1),
         round(avg(v) FILTER (WHERE tipo='escala_10'), 1)
    INTO v_estrellas, v_escala FROM vals;
  SELECT count(*) INTO v_total FROM public.curso_encuesta_respuestas;
  SELECT count(*) INTO v_pub FROM public.curso_encuesta_respuestas WHERE permite_publicar;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', t.nombre, 'comentario', t.comentario, 'foto_url', t.foto_url,
      'curso', t.curso_titulo, 'estrellas', t.estrellas
    ) ORDER BY t.orden, t.created_at), '[]'::jsonb)
    INTO v_cards FROM public.landing_testimonios t WHERE t.activo;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'label', m->>'label',
      'sufijo', COALESCE(m->>'sufijo',''),
      'valor', CASE m->>'kind'
        WHEN 'estrellas_global' THEN to_char(COALESCE(v_estrellas,0),'FM999990.0')
        WHEN 'escala_global'    THEN to_char(COALESCE(v_escala,0),'FM999990.0')
        WHEN 'opiniones'        THEN v_total::text
        WHEN 'publicables'      THEN v_pub::text
        WHEN 'manual'           THEN COALESCE(m->>'valor','')
        ELSE '' END
    ) ORDER BY ord), '[]'::jsonb)
    INTO v_metricas_out
  FROM jsonb_array_elements(COALESCE(v_metricas,'[]'::jsonb)) WITH ORDINALITY AS x(m, ord);

  RETURN jsonb_build_object(
    'activa', COALESCE(v_activa, true) AND jsonb_array_length(v_cards) > 0,
    'titulo', v_titulo,
    'metricas', v_metricas_out,
    'cards', v_cards,
    'agg', jsonb_build_object('rating', v_estrellas, 'count', v_total)
  );
END; $$;
REVOKE ALL ON FUNCTION public.landing_opiniones_publicas() FROM public;
GRANT EXECUTE ON FUNCTION public.landing_opiniones_publicas() TO anon, authenticated, service_role;

-- ============================================================================
-- 4. RPC admin (staff) — estado del manager
-- ============================================================================
DROP FUNCTION IF EXISTS public.landing_opiniones_admin();
CREATE FUNCTION public.landing_opiniones_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_titulo text; v_activa boolean; v_metricas jsonb; v_cards jsonb; v_pool jsonb;
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT landing_opiniones_titulo, landing_opiniones_activa, landing_opiniones_metricas
    INTO v_titulo, v_activa, v_metricas FROM public.config_global WHERE id=1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id, 'respuesta_id', t.respuesta_id, 'nombre', t.nombre, 'comentario', t.comentario,
      'foto_url', t.foto_url, 'curso', t.curso_titulo, 'estrellas', t.estrellas,
      'orden', t.orden, 'activo', t.activo, 'origen', t.origen
    ) ORDER BY t.orden, t.created_at), '[]'::jsonb)
    INTO v_cards FROM public.landing_testimonios t;

  -- pool: publicables CON comentario, aún no cardeadas
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

  RETURN jsonb_build_object('titulo', v_titulo, 'activa', v_activa, 'metricas', v_metricas,
    'cards', v_cards, 'pool', v_pool);
END; $$;
REVOKE ALL ON FUNCTION public.landing_opiniones_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_opiniones_admin() TO authenticated, service_role;

-- ============================================================================
-- 5. RPCs de curaduría (staff)
-- ============================================================================
-- agregar desde una respuesta publicable (snapshot + consentimiento duro)
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
  -- estrellas representativas: promedio de las preguntas estrellas de ESA respuesta
  SELECT round(avg((r.respuestas->>(pq->>'id'))::numeric),1) INTO v_estrellas
  FROM jsonb_array_elements(COALESCE(v_sch->'preguntas','[]'::jsonb)) pq
  WHERE pq->>'tipo'='estrellas' AND r.respuestas ? (pq->>'id')
    AND jsonb_typeof(r.respuestas->(pq->>'id'))='number';

  INSERT INTO public.landing_testimonios (respuesta_id, nombre, comentario, foto_url, curso_titulo, estrellas, orden, origen, created_by)
  VALUES (p_respuesta_id, v_nombre, btrim(r.testimonio_comentario), r.testimonio_foto_url, v_curso, v_estrellas,
          COALESCE((SELECT max(orden)+1 FROM public.landing_testimonios), 0), 'encuesta', auth.uid())
  ON CONFLICT (respuesta_id) WHERE respuesta_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_agregar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_agregar(uuid) TO authenticated, service_role;

-- agregar card manual
DROP FUNCTION IF EXISTS public.landing_testimonio_manual(text, text, text, text);
CREATE FUNCTION public.landing_testimonio_manual(p_nombre text, p_comentario text, p_curso text DEFAULT NULL, p_foto_url text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF COALESCE(btrim(p_nombre),'')='' OR COALESCE(btrim(p_comentario),'')='' THEN RAISE EXCEPTION 'nombre y comentario requeridos'; END IF;
  INSERT INTO public.landing_testimonios (nombre, comentario, curso_titulo, foto_url, orden, origen, created_by)
  VALUES (btrim(p_nombre), btrim(p_comentario), NULLIF(btrim(COALESCE(p_curso,'')),''), NULLIF(btrim(COALESCE(p_foto_url,'')),''),
          COALESCE((SELECT max(orden)+1 FROM public.landing_testimonios), 0), 'manual', auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_manual(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_manual(text, text, text, text) TO authenticated, service_role;

-- reordenar (set orden por posición del array)
DROP FUNCTION IF EXISTS public.landing_testimonio_reordenar(uuid[]);
CREATE FUNCTION public.landing_testimonio_reordenar(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.is_gerente() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.landing_testimonios t SET orden = x.ord
  FROM (SELECT unnest(p_ids) AS id, generate_subscripts(p_ids,1) AS ord) x
  WHERE t.id = x.id;
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.landing_testimonio_reordenar(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.landing_testimonio_reordenar(uuid[]) TO authenticated, service_role;

-- ============================================================================
-- 6. Trigger: aviso a gerencia cada +20 publicables (R17)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.landing_opiniones_notif_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer; v_ultimo integer; v_ger record; v_cuerpo text;
BEGIN
  IF NOT COALESCE(NEW.permite_publicar, false) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.curso_encuesta_respuestas WHERE permite_publicar;
  SELECT landing_opiniones_ultimo_notif INTO v_ultimo FROM public.config_global WHERE id=1;
  IF v_count - COALESCE(v_ultimo,0) < 20 THEN RETURN NEW; END IF;

  v_cuerpo := 'Hay ' || v_count || ' opiniones publicables acumuladas (antes avisamos en ' || COALESCE(v_ultimo,0)
    || '). Entrá a Configuración → Encuestas · Envío al CM → Sección de la landing para revisar y actualizar las opiniones destacadas de la web.';
  FOR v_ger IN
    SELECT u.email, COALESCE(p.full_name,'Gerencia') AS nombre
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.role = 'gerente' AND p.activo = true AND u.email IS NOT NULL
  LOOP
    INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, related_table, programado_para)
    VALUES ('workflow', 'gerencia-notif-generica', v_ger.email, v_ger.nombre,
            jsonb_build_object('titulo_evento','Nuevas opiniones para la landing','cuerpo',v_cuerpo,
                               'url','/gerencia/configuracion/encuestas-cm'), 5, 'landing_testimonios', now());
  END LOOP;
  UPDATE public.config_global SET landing_opiniones_ultimo_notif = v_count WHERE id=1;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_landing_opiniones_notif ON public.curso_encuesta_respuestas;
CREATE TRIGGER trg_landing_opiniones_notif
  AFTER INSERT OR UPDATE OF permite_publicar ON public.curso_encuesta_respuestas
  FOR EACH ROW EXECUTE FUNCTION public.landing_opiniones_notif_check();

-- ============================================================================
-- 7. Seed: las 3 cards legacy (estaban hardcodeadas en LandingPage) + contador
-- ============================================================================
INSERT INTO public.landing_testimonios (nombre, comentario, curso_titulo, orden, origen)
SELECT * FROM (VALUES
  ('Olga Romero Núñez', 'La atención y dedicación que recibí fue digna de difundir. Recomiendo Gestión Global a colegas sin dudar.', 'Administradora de consorcios', 1, 'manual'),
  ('Vanesa Agote', 'Me sorprendió todo: la dinámica, las clases, el contenido. Lo súper recomiendo.', 'Administradora de consorcios', 2, 'manual'),
  ('Julio Ariel Fernández', 'Con Gestión Global la administración de nuestros consorcios fue mucho más eficiente y organizada.', 'Administrador de consorcios', 3, 'manual')
) AS s(nombre, comentario, curso_titulo, orden, origen)
WHERE NOT EXISTS (SELECT 1 FROM public.landing_testimonios WHERE origen='manual');

-- el contador arranca en el nivel actual de publicables (el próximo aviso es +20)
UPDATE public.config_global
   SET landing_opiniones_ultimo_notif = (SELECT count(*) FROM public.curso_encuesta_respuestas WHERE permite_publicar)
 WHERE id = 1 AND landing_opiniones_ultimo_notif = 0;
