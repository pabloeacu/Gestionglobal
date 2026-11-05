-- 0654 · DGG-244 · LexPH F3 — Apertura pública gateada + slot de imagen de portada.
--
-- Expone los artículos PUBLICADOS a lectura anónima, pero **a oscuras por default**: un flag
-- `config_global.lexph_publico_activo` (arranca FALSE) gatea todo. Mientras está apagado, las RPCs
-- públicas devuelven vacío y no hay superficie. La lectura anon NO se hace abriendo las tablas
-- (siguen `anon`-bloqueadas, como en F1) sino por RPCs SECURITY DEFINER que devuelven SÓLO lo
-- publicado y SÓLO los campos públicos (convención del repo: verificar_certificado,
-- landing_opiniones_publicas). El flag se clona de get_landing_cover_status (mig 0061); el gate anon
-- vive en `public` porque anon no tiene USAGE sobre el schema `private`.
--
-- 100% ADITIVO: no modifica policies/grants existentes (las tablas siguen staff-only para authenticated);
-- sólo agrega columnas nuevas (nullable / con default) y funciones net-new, y EXTIENDE la RPC de
-- guardado con la imagen (R16: DROP de la firma vieja + CREATE de la nueva, cero overload).
-- Reglas: R2, R5, R6, R8, R11, R16.

-- ============================================================================
-- 1. Flag (default FALSE = a oscuras) + slot de imagen de portada
-- ============================================================================
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS lexph_publico_activo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.config_global.lexph_publico_activo IS
  'DGG-244 F3 · Cortina de la web pública de LexPH. FALSE = a oscuras (RPCs públicas devuelven vacío). Se togglea por set_lexph_publico (staff).';

ALTER TABLE public.lexph_articulos
  ADD COLUMN IF NOT EXISTS imagen_url text,
  ADD COLUMN IF NOT EXISTS imagen_alt text;
COMMENT ON COLUMN public.lexph_articulos.imagen_url IS
  'DGG-244 · URL de imagen de portada. Preferir Supabase Storage (está en la CSP img-src; una URL externa sólo carga bajo la CSP Report-Only actual). Null → fallback de marca por tipo. Se poblará con generación asistida más adelante.';

-- ============================================================================
-- 2. Flag: status anon-callable (front gate + noindex) y setter staff-only
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_lexph_publico_status()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$ SELECT COALESCE(lexph_publico_activo, false) FROM public.config_global WHERE id = 1; $$;
REVOKE ALL ON FUNCTION public.get_lexph_publico_status() FROM public;
GRANT EXECUTE ON FUNCTION public.get_lexph_publico_status() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_lexph_publico(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede abrir/cerrar la web pública de LexPH.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.config_global SET lexph_publico_activo = p_enabled WHERE id = 1;
  RETURN p_enabled;
END; $$;
REVOKE ALL ON FUNCTION public.set_lexph_publico(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_lexph_publico(boolean) TO authenticated;

-- ============================================================================
-- 3. Lectura pública (anon) — SÓLO publicados + campos públicos, gateada por el flag
-- ============================================================================
-- Feed completo de publicados (R19: universo completo; el front filtra por tipo/etiqueta en memoria).
CREATE OR REPLACE FUNCTION public.lexph_publico_feed()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT COALESCE(jsonb_agg(obj ORDER BY pub DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      jsonb_build_object(
        'id', a.id, 'slug', a.slug, 'tipo', a.tipo, 'titulo', a.titulo,
        'resumen', a.resumen, 'imagen_url', a.imagen_url, 'imagen_alt', a.imagen_alt,
        'publicado_at', a.publicado_at,
        'tags', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'nombre', t.nombre, 'tipo', t.tipo)
                          ORDER BY t.orden, t.nombre), '[]'::jsonb)
          FROM public.lexph_articulo_tags atg
          JOIN public.lexph_tags t ON t.id = atg.tag_id AND t.activo
          WHERE atg.articulo_id = a.id
        )
      ) AS obj,
      a.publicado_at AS pub
    FROM public.lexph_articulos a
    WHERE a.estado = 'publicado'
      AND public.get_lexph_publico_status()
  ) s;
$$;
REVOKE ALL ON FUNCTION public.lexph_publico_feed() FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_publico_feed() TO anon, authenticated;

-- Un artículo publicado por slug (incluye cuerpo HTML + campos + fuentes). Null si no existe / a oscuras.
CREATE OR REPLACE FUNCTION public.lexph_publico_articulo(p_slug text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT CASE WHEN public.get_lexph_publico_status() THEN (
    SELECT jsonb_build_object(
      'id', a.id, 'slug', a.slug, 'tipo', a.tipo, 'titulo', a.titulo,
      'resumen', a.resumen, 'cuerpo', a.cuerpo, 'campos', a.campos, 'fuentes', a.fuentes,
      'imagen_url', a.imagen_url, 'imagen_alt', a.imagen_alt, 'publicado_at', a.publicado_at,
      'tags', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'nombre', t.nombre, 'tipo', t.tipo)
                        ORDER BY t.orden, t.nombre), '[]'::jsonb)
        FROM public.lexph_articulo_tags atg
        JOIN public.lexph_tags t ON t.id = atg.tag_id AND t.activo
        WHERE atg.articulo_id = a.id
      )
    )
    FROM public.lexph_articulos a
    WHERE a.slug = p_slug AND a.estado = 'publicado'
  ) ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.lexph_publico_articulo(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_publico_articulo(text) TO anon, authenticated;

-- ============================================================================
-- 4. EXTENDER lexph_articulo_guardar con imagen (R16: DROP firma vieja + CREATE nueva)
-- ============================================================================
DROP FUNCTION IF EXISTS public.lexph_articulo_guardar(text,text,text,text,text,text,jsonb,jsonb,uuid[],uuid);

CREATE OR REPLACE FUNCTION public.lexph_articulo_guardar(
  p_tipo       text,
  p_estado     text,
  p_titulo     text,
  p_slug       text,
  p_resumen    text,
  p_cuerpo     text,
  p_campos     jsonb,
  p_fuentes    jsonb,
  p_tag_ids    uuid[],
  p_imagen_url text DEFAULT NULL,
  p_imagen_alt text DEFAULT NULL,
  p_id         uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede administrar LexPH.'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.lexph_articulos
      (tipo, estado, titulo, slug, resumen, cuerpo, campos, fuentes, imagen_url, imagen_alt, publicado_at, created_by)
    VALUES
      (p_tipo, p_estado, p_titulo, p_slug, p_resumen, p_cuerpo,
       COALESCE(p_campos, '{}'::jsonb), COALESCE(p_fuentes, '[]'::jsonb),
       p_imagen_url, p_imagen_alt,
       CASE WHEN p_estado = 'publicado' THEN now() ELSE NULL END,
       auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lexph_articulos SET
      tipo         = p_tipo,
      estado       = p_estado,
      titulo       = p_titulo,
      slug         = p_slug,
      resumen      = p_resumen,
      cuerpo       = p_cuerpo,
      campos       = COALESCE(p_campos, '{}'::jsonb),
      fuentes      = COALESCE(p_fuentes, '[]'::jsonb),
      imagen_url   = p_imagen_url,
      imagen_alt   = p_imagen_alt,
      publicado_at = CASE
                       WHEN p_estado = 'publicado' AND publicado_at IS NULL THEN now()
                       ELSE publicado_at
                     END
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Artículo no encontrado (id=%).', p_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  DELETE FROM public.lexph_articulo_tags WHERE articulo_id = v_id;
  IF p_tag_ids IS NOT NULL AND array_length(p_tag_ids, 1) IS NOT NULL THEN
    INSERT INTO public.lexph_articulo_tags (articulo_id, tag_id)
      SELECT v_id, t
      FROM unnest(p_tag_ids) AS t
      WHERE EXISTS (SELECT 1 FROM public.lexph_tags g WHERE g.id = t)
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un artículo con el identificador (slug) "%".', p_slug
      USING ERRCODE = '23505';
END;
$$;
COMMENT ON FUNCTION public.lexph_articulo_guardar IS
  'DGG-244 · LexPH — upsert de artículo + imagen + reemplazo de etiquetas (R5). SECURITY DEFINER gateada por private.is_staff(). publicado_at se sella en la 1ra publicación.';
REVOKE ALL ON FUNCTION public.lexph_articulo_guardar(text,text,text,text,text,text,jsonb,jsonb,uuid[],text,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_articulo_guardar(text,text,text,text,text,text,jsonb,jsonb,uuid[],text,text,uuid) TO authenticated;
