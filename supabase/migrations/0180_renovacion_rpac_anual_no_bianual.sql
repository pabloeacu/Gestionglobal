-- ============================================================================
-- 0180 · JL fix · "Renovación bianual de matrícula RPAC" → "Renovación anual"
--
-- La RENOVACIÓN de matrícula RPAC es ANUAL, no bianual. Lo bianual es el
-- "curso de actualización" — que es otra cosa (es el curso que el matriculado
-- tiene que cumplir cada 2 años para mantener vigente su matrícula). El error
-- del título mezclaba ambos conceptos.
--
-- Cambios:
--   1. titulo: "Renovación bianual de matrícula RPAC"
--             → "Renovación anual de matrícula RPAC"
--   2. descripcion: ajuste para reflejar la anualidad de la renovación,
--      manteniendo la mención al curso de actualización (que sí es bianual).
-- ============================================================================

UPDATE public.formularios
   SET titulo = 'Renovación anual de matrícula RPAC',
       descripcion = 'Renovación anual de la matrícula de administrador. Requiere certificado del curso de actualización vigente (vencimiento menor a 2 años).',
       updated_at = now()
 WHERE slug = 'renovacion-rpac';
