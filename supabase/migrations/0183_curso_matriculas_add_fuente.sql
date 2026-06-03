-- ============================================================================
-- 0183 · E-GG-42 · Agregar columna `fuente` a curso_matriculas
--
-- BUG: la migración 0172 (audit_d_fixes) modificó la RPC
-- `curso_asignar_alumno` para insertar `fuente = 'gerencia_manual'`,
-- pero NUNCA se agregó la columna a la tabla. Resultado: al asignar
-- un alumno desde gerencia salta el error
-- `column "fuente" of relation "curso_matriculas" does not exist`.
--
-- Reportado por José Luis (2026-06-02) en el detalle del curso de
-- formación RPAC.
--
-- Fix: agregar la columna como `text` (sin check constraint para no
-- ser frágiles ante futuras fuentes), con default 'gerencia_manual' y
-- backfill semántico para las filas existentes.
--
-- Valores típicos:
--   gerencia_manual       · admin gerencia asigna manualmente.
--   formulario_publico    · alumno se inscribió por formulario público
--                           (en estas filas submission_origen NOT NULL).
--   webinar_auto          · matrícula auto-creada desde un webinar.
--   import_legacy         · datos importados desde Excel histórico.
--   otro                  · valor catch-all.
-- ============================================================================

ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS fuente text;

-- Backfill semántico para filas existentes
UPDATE public.curso_matriculas
   SET fuente = CASE
     WHEN submission_origen IS NOT NULL THEN 'formulario_publico'
     ELSE 'gerencia_manual'
   END
 WHERE fuente IS NULL;

-- Default para futuros INSERTs sin fuente explícita
ALTER TABLE public.curso_matriculas
  ALTER COLUMN fuente SET DEFAULT 'gerencia_manual';

COMMENT ON COLUMN public.curso_matriculas.fuente IS
  'E-GG-42 (2026-06-02): origen de la matrícula. Valores típicos: '
  'gerencia_manual, formulario_publico, webinar_auto, import_legacy, otro. '
  'Sin check constraint para tolerar futuras fuentes.';
