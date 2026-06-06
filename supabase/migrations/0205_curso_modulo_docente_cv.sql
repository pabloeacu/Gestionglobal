-- 0205 · CV del docente por asignatura (módulo) — descargable por el alumno (DGG-51)
--
-- La mig 0204 agregó docente_nombre/foto/bio a cada módulo (asignatura). Ahora
-- el docente puede tener además su CV en PDF, que el alumno descarga si lo desea
-- (desde el nav del curso y junto al reproductor de cada clase). El archivo se
-- sube al bucket público campus-media (scope modulo-docente-cv) vía
-- uploadCampusMedia (R20 safeStorageKey).
--
-- ALTER sobre tabla existente → los GRANTs vigentes de curso_modulos cubren la
-- columna nueva (R6 aplica a CREATE TABLE, no a ADD COLUMN).
ALTER TABLE public.curso_modulos
  ADD COLUMN IF NOT EXISTS docente_cv_url text;
