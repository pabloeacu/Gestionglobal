-- ============================================================================
-- Mig 0140 · Campus L1 (sesión 30/05/2026):
--   (1) Imágenes: instructor del curso, icono por módulo, foto del instructor
--       por clase asincrónica, archivo por bibliografía.
--   (2) Publicación con fechas: cada módulo, clase y bibliografía puede
--       publicarse ahora, programarse o despublicarse.
--   (3) Helper SQL `public.is_visible_for_alumno(...)` que centraliza la
--       evaluación (publicado + ventana publicar_at/despublicar_at).
--   (4) Bucket público `campus-media` para banners/íconos/fotos del docente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cursos · instructor_foto_url + ventana de publicación
-- ----------------------------------------------------------------------------
ALTER TABLE public.cursos
  ADD COLUMN IF NOT EXISTS instructor_foto_url text,
  ADD COLUMN IF NOT EXISTS publicar_at        timestamptz,
  ADD COLUMN IF NOT EXISTS despublicar_at     timestamptz;

COMMENT ON COLUMN public.cursos.publicar_at IS
  'Si está seteada y aún no llegó, el curso queda oculto al alumno incluso con activo=true.';
COMMENT ON COLUMN public.cursos.despublicar_at IS
  'Si está seteada y ya pasó, el curso queda oculto al alumno incluso con activo=true.';

-- ----------------------------------------------------------------------------
-- 2. curso_modulos · icono + publicación
-- ----------------------------------------------------------------------------
ALTER TABLE public.curso_modulos
  ADD COLUMN IF NOT EXISTS icono_url       text,
  ADD COLUMN IF NOT EXISTS publicado       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS publicar_at     timestamptz,
  ADD COLUMN IF NOT EXISTS despublicar_at  timestamptz;

COMMENT ON COLUMN public.curso_modulos.icono_url IS
  'Imagen tipo ícono para encabezar la sección (sincrónicas, asincrónicas, bibliografía…).';

-- ----------------------------------------------------------------------------
-- 3. curso_clases · foto del instructor + publicación
-- ----------------------------------------------------------------------------
ALTER TABLE public.curso_clases
  ADD COLUMN IF NOT EXISTS instructor_foto_url text,
  ADD COLUMN IF NOT EXISTS publicado           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS publicar_at         timestamptz,
  ADD COLUMN IF NOT EXISTS despublicar_at      timestamptz;

COMMENT ON COLUMN public.curso_clases.instructor_foto_url IS
  'Foto circular del docente que dicta la clase (típico para asincrónicas).';

-- ----------------------------------------------------------------------------
-- 4. curso_bibliografia · publicación
-- ----------------------------------------------------------------------------
ALTER TABLE public.curso_bibliografia
  ADD COLUMN IF NOT EXISTS publicado       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS publicar_at     timestamptz,
  ADD COLUMN IF NOT EXISTS despublicar_at  timestamptz;

-- ----------------------------------------------------------------------------
-- 5. Helper SQL · ¿es visible para un alumno ahora?
--    Reglas:
--      · publicado=false ⇒ NO visible.
--      · publicar_at IS NOT NULL AND publicar_at > now() ⇒ NO visible (programado a futuro).
--      · despublicar_at IS NOT NULL AND despublicar_at <= now() ⇒ NO visible (ya despublicado).
--      · resto ⇒ visible.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_visible_for_alumno(
  p_publicado      boolean,
  p_publicar_at    timestamptz,
  p_despublicar_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_publicado, true)
     AND (p_publicar_at    IS NULL OR p_publicar_at <= now())
     AND (p_despublicar_at IS NULL OR p_despublicar_at > now());
$$;

GRANT EXECUTE ON FUNCTION public.is_visible_for_alumno(boolean, timestamptz, timestamptz) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 6. Bucket público `campus-media` para banners/íconos/fotos
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('campus-media', 'campus-media', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Políticas: lectura pública (es bucket público), escritura por staff (gerencia).
DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='campus_media_read_public') THEN
    CREATE POLICY campus_media_read_public ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'campus-media');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='campus_media_write_staff') THEN
    CREATE POLICY campus_media_write_staff ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'campus-media' AND private.is_staff())
      WITH CHECK (bucket_id = 'campus-media' AND private.is_staff());
  END IF;
END $pol$;
