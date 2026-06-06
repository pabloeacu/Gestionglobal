-- 0204 · Docente a cargo por asignatura (módulo) del campus (DGG-50)
--
-- El curso "Actualización 2026 RPAC" tiene 5 asignaturas asincrónicas, cada una
-- con su propio docente (Lic. González, Dr. Castro, Dra. Lucero, F. Beuchel,
-- Dra. Suken). El modelo previo solo tenía instructor a nivel curso (uno) y
-- foto por clase (sin nombre). Agregamos el docente por módulo: nombre + foto +
-- bio, editable desde el editor de contenido (gerencia) y visible para el
-- alumno encabezando cada asignatura y junto al reproductor de cada clase.
--
-- ALTER sobre tabla existente → los GRANTs vigentes de curso_modulos cubren las
-- columnas nuevas (R6 aplica a CREATE TABLE, no a ADD COLUMN).
ALTER TABLE public.curso_modulos
  ADD COLUMN IF NOT EXISTS docente_nombre   text,
  ADD COLUMN IF NOT EXISTS docente_foto_url text,
  ADD COLUMN IF NOT EXISTS docente_bio      text;
