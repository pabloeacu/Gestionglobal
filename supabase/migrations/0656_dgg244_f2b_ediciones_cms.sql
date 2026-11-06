-- 0656 · DGG-244 F2b · CMS de ediciones (digest editor + destacada + cerrar edición)
--                      + auto-asignación de notas a la edición en curso.
--
-- Lifecycle (decidido con Pablo, modelo simple y coherente):
--   · La edición EN CURSO = la de mayor `seq`. Siempre `publicada` → es "la edición actual"
--     que la web muestra (digest + badge "Nuevo"). Gerencia edita SU digest en vivo.
--   · Las NOTAS se auto-asignan (edicion_id) a esa edición al publicarse (trigger). Se acumulan
--     y quedan vigentes para siempre; edicion_id sólo marca el debut (badge "Nuevo" / agrupación).
--   · "Cerrar edición" congela la actual (sus notas quedan como de esa edición) y abre la próxima
--     (seq+1, publicada, digest VACÍO). A partir de ahí, las notas nuevas debutan en la próxima y
--     las de la cerrada pasan a históricas. El digest vacío no se muestra (LexphDigest → null) hasta
--     que gerencia lo complete. El envío del newsletter (F2d) se enganchará acá más adelante.
--
-- 100% ADITIVO. Funciones net-new (R16 N/A: sin overloads). R2/R5/R6/R17 contempladas.

-- ============================================================================
-- 1. Auto-asignación de notas a la edición en curso (la de mayor seq)
--    BEFORE trigger: sólo setea NEW.edicion_id (no escribe otra tabla → R17 N/A, pero SECDEF
--    asegura el SELECT sobre lexph_ediciones aunque cambie el gating a futuro).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_articulo_set_edicion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Al publicar una nota sin edición, debuta en la edición en curso (mayor seq).
  IF NEW.estado = 'publicado' AND NEW.edicion_id IS NULL THEN
    SELECT e.id INTO NEW.edicion_id
    FROM public.lexph_ediciones e
    ORDER BY e.seq DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.lexph_articulo_set_edicion IS
  'DGG-244 F2b · Auto-asigna edicion_id (edición en curso = mayor seq) al publicar una nota sin edición.';

DROP TRIGGER IF EXISTS trg_lexph_articulo_set_edicion ON public.lexph_articulos;
CREATE TRIGGER trg_lexph_articulo_set_edicion
  BEFORE INSERT OR UPDATE OF estado, edicion_id ON public.lexph_articulos
  FOR EACH ROW EXECUTE FUNCTION public.lexph_articulo_set_edicion();

-- ============================================================================
-- 2. Lectura de la edición EN CURSO para el editor de gerencia (staff-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_edicion_actual_staff()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT CASE WHEN (SELECT private.is_staff()) THEN (
    SELECT to_jsonb(e) FROM public.lexph_ediciones e
    ORDER BY e.seq DESC
    LIMIT 1
  ) ELSE NULL END;
$$;
COMMENT ON FUNCTION public.lexph_edicion_actual_staff IS
  'DGG-244 F2b · Devuelve la edición en curso (mayor seq) para el CMS de gerencia. Staff-only.';
REVOKE ALL ON FUNCTION public.lexph_edicion_actual_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_edicion_actual_staff() TO authenticated;

-- ============================================================================
-- 3. Guardar el digest de una edición (intro / resumen / tendencias / editorial / destacada)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_edicion_guardar(
  p_id                    uuid,
  p_titulo_interno        text,
  p_intro                 text,
  p_resumen               jsonb,
  p_tendencias            jsonb,
  p_editorial             jsonb,
  p_destacado_articulo_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (SELECT private.is_staff()) THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede administrar LexPH.' USING ERRCODE = '42501';
  END IF;

  -- La destacada, si se indica, debe ser una nota publicada (coherencia aviso↔display).
  IF p_destacado_articulo_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.lexph_articulos a
       WHERE a.id = p_destacado_articulo_id AND a.estado = 'publicado'
     ) THEN
    RAISE EXCEPTION 'La nota de tapa debe ser un artículo publicado.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.lexph_ediciones SET
    titulo_interno        = COALESCE(NULLIF(btrim(p_titulo_interno), ''), titulo_interno),
    intro                 = NULLIF(btrim(COALESCE(p_intro, '')), ''),
    resumen               = COALESCE(p_resumen, '[]'::jsonb),
    tendencias            = COALESCE(p_tendencias, '[]'::jsonb),
    editorial             = COALESCE(p_editorial, '{}'::jsonb),
    destacado_articulo_id = p_destacado_articulo_id,
    updated_at            = now()
  WHERE id = p_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Edición no encontrada (id=%).', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.lexph_edicion_guardar IS
  'DGG-244 F2b · Upsert del digest de una edición (se pisa por edición). Staff-only. R5.';
REVOKE ALL ON FUNCTION public.lexph_edicion_guardar(uuid, text, text, jsonb, jsonb, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_edicion_guardar(uuid, text, text, jsonb, jsonb, jsonb, uuid) TO authenticated;

-- ============================================================================
-- 4. Cerrar edición → congela la actual y abre la próxima (seq+1, publicada, digest vacío)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_edicion_cerrar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq_max int;
  v_seq_cerrar int;
  v_new uuid;
BEGIN
  IF NOT (SELECT private.is_staff()) THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede administrar LexPH.' USING ERRCODE = '42501';
  END IF;

  SELECT max(seq) INTO v_seq_max FROM public.lexph_ediciones;
  SELECT seq INTO v_seq_cerrar FROM public.lexph_ediciones WHERE id = p_id;

  IF v_seq_cerrar IS NULL THEN
    RAISE EXCEPTION 'Edición no encontrada (id=%).', p_id USING ERRCODE = 'P0002';
  END IF;
  -- Sólo se cierra la edición EN CURSO (la de mayor seq); evita abrir huecos de seq.
  IF v_seq_cerrar <> v_seq_max THEN
    RAISE EXCEPTION 'Sólo se puede cerrar la edición en curso.' USING ERRCODE = '22023';
  END IF;

  -- Congelar la actual: asegurar publicada + publicado_at sellado.
  UPDATE public.lexph_ediciones
     SET estado = 'publicada',
         publicado_at = COALESCE(publicado_at, now()),
         updated_at = now()
   WHERE id = p_id;

  -- Abrir la próxima (digest vacío; se muestra recién cuando gerencia lo completa).
  INSERT INTO public.lexph_ediciones (seq, titulo_interno, estado, publicado_at)
  VALUES (v_seq_max + 1, 'Edición N°' || (v_seq_max + 1), 'publicada', now())
  RETURNING id INTO v_new;

  RETURN (SELECT to_jsonb(e) FROM public.lexph_ediciones e WHERE e.id = v_new);
END;
$$;
COMMENT ON FUNCTION public.lexph_edicion_cerrar IS
  'DGG-244 F2b · Congela la edición en curso y abre la próxima (seq+1, publicada, digest vacío). Staff-only.';
REVOKE ALL ON FUNCTION public.lexph_edicion_cerrar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_edicion_cerrar(uuid) TO authenticated;
