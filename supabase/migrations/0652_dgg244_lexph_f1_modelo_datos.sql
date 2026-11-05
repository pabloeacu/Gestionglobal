-- 0652 · DGG-244 · LexPH F1 — Modelo de datos del hub editorial (CMS de gerencia).
--
-- LexPH ("un servicio de Gestión Global") = sección de contenidos para profesionales de la
-- propiedad horizontal: fallos comentados, normativas, novedades internacionales e insights.
-- Formato tipo cacycu.org.ar/category/normativas (listado por categoría/etiqueta) que a futuro
-- (Fase 2) se destila en un newsletter quincenal. Pablo: arrancamos MANUAL (carga a mano por
-- gerencia), audiencia abierta a futuro (captación + SEO), pero en Fase 1 queda A OSCURAS: sin
-- URL pública, sin acceso anon. La apertura al público entra en una fase posterior detrás de un
-- flag config_global + noindex (molde get_landing_cover_status / mig 0061).
--
-- Diseño (molde canónico tracking_plantillas, mig 0517): contenido administrado SÓLO por staff
-- (gerente/operador), RLS activa staff-only, GRANT least-privilege explícito (R6), updated_at por
-- trigger (public.touch_updated_at). El cuerpo largo es HTML (sale del editor TipTap del repo) y
-- se sanitiza con DOMPurify al renderizar en el front. Los campos estructurados por tipo (tribunal,
-- sala, carátula, voces, "clave para el administrador", etc.) viven en `campos jsonb` y las fuentes
-- citables en `fuentes jsonb` — así el modelo absorbe fallo/normativa/internacional/insight sin
-- una tabla por tipo.
--
-- Reglas aplicadas: R2 (RLS activa), R4 (sin from() en componentes: todo por services/api), R5
-- (guardar artículo + etiquetas = 2 tablas → RPC SECURITY DEFINER), R6 (GRANT explícito + REVOKE
-- least-privilege post-0130), R8 (schema en inglés técnico; copy del dominio en español), R11 (FK
-- indexada), R16 (RPC net-new, cero overload). 100% ADITIVO: no toca ningún objeto existente.

-- ============================================================================
-- 1. ETIQUETAS — materia (ej. seguros, asambleas) y jurisdicción (CABA, PBA, …)
-- ============================================================================
CREATE TABLE public.lexph_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,                 -- estable, usable en la futura URL (/lexph/tema/<slug>)
  nombre     text NOT NULL,                        -- etiqueta visible (español)
  tipo       text NOT NULL CHECK (tipo IN ('materia','jurisdiccion')),
  orden      smallint NOT NULL DEFAULT 0,          -- orden en pickers / nubes de etiquetas
  activo     boolean NOT NULL DEFAULT true,        -- inactiva = no se ofrece en el picker
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lexph_tags IS
  'DGG-244 · LexPH — taxonomía del hub editorial: tipo=materia (temática) | jurisdiccion. '
  'Staff-only (RLS); se abrirá a lectura anon en la fase pública (flag + noindex).';

ALTER TABLE public.lexph_tags ENABLE ROW LEVEL SECURITY;
-- R6 least-privilege EXACTO: Supabase grantea ALL a authenticated/anon por default privileges
-- (incluye TRUNCATE, que IGNORA RLS). Revocamos y otorgamos sólo lo necesario.
REVOKE ALL ON public.lexph_tags FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lexph_tags TO authenticated;
-- anon: nada todavía (Fase 1 a oscuras).

CREATE POLICY lexph_tags_staff_all ON public.lexph_tags
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

CREATE TRIGGER trg_lexph_tags_touch
  BEFORE UPDATE ON public.lexph_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_lexph_tags_tipo_orden ON public.lexph_tags (tipo, activo, orden, nombre);

-- ============================================================================
-- 2. ARTÍCULOS — fallo | normativa | internacional | insight
-- ============================================================================
CREATE TABLE public.lexph_articulos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,               -- /lexph/<slug> en la fase pública
  tipo         text NOT NULL CHECK (tipo IN ('fallo','normativa','internacional','insight')),
  estado       text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicado')),
  titulo       text NOT NULL,
  resumen      text,                               -- bajada / copete (cards + newsletter); null en borrador
  cuerpo       text,                               -- HTML del editor TipTap; se sanitiza (DOMPurify) al render
  campos       jsonb NOT NULL DEFAULT '{}'::jsonb, -- estructurado por tipo (ver COMMENT)
  fuentes      jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ cita text, url text }] — fuentes citables
  publicado_at timestamptz,                        -- se sella en la 1ra publicación; null mientras borrador
  created_by   uuid DEFAULT auth.uid(),            -- gerente que lo creó (informativo; null en seeds)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lexph_articulos IS
  'DGG-244 · LexPH — pieza editorial. cuerpo = HTML (TipTap) sanitizado en el front con DOMPurify. '
  'campos jsonb por tipo: fallo → {tribunal,sala,fecha,caratula,voces[],clave_administrador,'
  'riesgo_oportunidad}; normativa → {organismo,norma,fecha,clave_administrador}; '
  'internacional → {pais,organismo,norma,fecha,clave_administrador}; insight → libre. '
  '(La jurisdicción NO va en campos: se modela como etiqueta tipo=jurisdiccion.) '
  'Staff-only (RLS); lectura anon de estado=publicado se habilita en la fase pública (flag + noindex).';

ALTER TABLE public.lexph_articulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lexph_articulos FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lexph_articulos TO authenticated;

CREATE POLICY lexph_articulos_staff_all ON public.lexph_articulos
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

CREATE TRIGGER trg_lexph_articulos_touch
  BEFORE UPDATE ON public.lexph_articulos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Feed de la fase pública + grilla de gerencia: publicados por fecha desc.
CREATE INDEX idx_lexph_articulos_feed ON public.lexph_articulos (estado, publicado_at DESC);
CREATE INDEX idx_lexph_articulos_tipo ON public.lexph_articulos (tipo);

-- ============================================================================
-- 3. ARTÍCULO ↔ ETIQUETA (M2M)
-- ============================================================================
CREATE TABLE public.lexph_articulo_tags (
  articulo_id uuid NOT NULL REFERENCES public.lexph_articulos(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES public.lexph_tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (articulo_id, tag_id)
);
COMMENT ON TABLE public.lexph_articulo_tags IS
  'DGG-244 · LexPH — vínculo M2M artículo↔etiqueta. Se reemplaza en bloque vía lexph_articulo_guardar.';

ALTER TABLE public.lexph_articulo_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lexph_articulo_tags FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lexph_articulo_tags TO authenticated;

CREATE POLICY lexph_articulo_tags_staff_all ON public.lexph_articulo_tags
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

-- R11: la PK indexa articulo_id (1ra col); el otro lado del FK (tag_id) necesita su índice.
CREATE INDEX idx_lexph_articulo_tags_tag ON public.lexph_articulo_tags (tag_id);

-- ============================================================================
-- 4. RPC — guardar artículo + reemplazar su set de etiquetas (R5: 2 tablas → SD)
-- ============================================================================
-- Upsert atómico: con p_id null inserta, si no actualiza; luego reemplaza las etiquetas en bloque.
-- Gateada por private.is_staff() (R12 no aplica: LexPH es contenido global, sin eje administración).
-- publicado_at se sella SÓLO en la primera transición a 'publicado' y no se borra al volver a borrador.
CREATE OR REPLACE FUNCTION public.lexph_articulo_guardar(
  p_tipo    text,
  p_estado  text,
  p_titulo  text,
  p_slug    text,
  p_resumen text,
  p_cuerpo  text,
  p_campos  jsonb,
  p_fuentes jsonb,
  p_tag_ids uuid[],
  p_id      uuid DEFAULT NULL
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
      (tipo, estado, titulo, slug, resumen, cuerpo, campos, fuentes, publicado_at, created_by)
    VALUES
      (p_tipo, p_estado, p_titulo, p_slug, p_resumen, p_cuerpo,
       COALESCE(p_campos, '{}'::jsonb), COALESCE(p_fuentes, '[]'::jsonb),
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

  -- Reemplazo en bloque del set de etiquetas.
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
  'DGG-244 · LexPH — upsert de artículo + reemplazo de etiquetas (R5). SECURITY DEFINER gateada por '
  'private.is_staff(). publicado_at se sella en la 1ra publicación.';

REVOKE ALL ON FUNCTION public.lexph_articulo_guardar(text,text,text,text,text,text,jsonb,jsonb,uuid[],uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lexph_articulo_guardar(text,text,text,text,text,text,jsonb,jsonb,uuid[],uuid) TO authenticated;
