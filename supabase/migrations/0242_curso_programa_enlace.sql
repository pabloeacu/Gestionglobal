-- ============================================================================
-- 0242_curso_programa_enlace.sql
-- DGG-81 · Dos recursos de curso a nivel campus: "Programa" + "Enlace de conexión"
--
-- Aparecen como nodos ARRIBA DE TODO en el menú lateral del curso (alumno) y SOLO
-- cuando tienen contenido (igual que Bibliografía/Encuentros). El gerente los
-- configura en "Datos generales".
--   · Programa: un archivo (PDF) → programa_url (storage campus-media).
--   · Enlace de conexión: título + descripción + URL → botón.
--
-- Son metadatos 1:1 a nivel curso → columnas en `cursos` (no tabla aparte),
-- siguiendo el patrón de banner_url/instructor_*. `cursos` es tabla pre-0130:
-- el GRANT a authenticated ya existe a nivel tabla y cubre las columnas nuevas.
-- Storage: ya cubierto por la policy campus_media_write_staff (cualquier staff
-- escribe en campus-media). RLS de cursos: sin cambios.
-- ============================================================================

ALTER TABLE public.cursos
  ADD COLUMN IF NOT EXISTS programa_url        text,
  ADD COLUMN IF NOT EXISTS enlace_titulo       text,
  ADD COLUMN IF NOT EXISTS enlace_descripcion  text,
  ADD COLUMN IF NOT EXISTS enlace_url          text;

COMMENT ON COLUMN public.cursos.programa_url IS
  'DGG-81: PDF del programa del curso (campus-media). Nodo "Programa" en el menú del alumno, visible solo si no es NULL.';
COMMENT ON COLUMN public.cursos.enlace_url IS
  'DGG-81: URL del nodo "Enlace de conexión" (con enlace_titulo + enlace_descripcion → botón). Visible solo si no es NULL.';
