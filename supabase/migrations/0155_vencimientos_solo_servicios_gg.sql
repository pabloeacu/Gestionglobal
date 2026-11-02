-- ============================================================================
-- Mig 0155 · FIX-V3 · Vencimientos SOLO servicios GG (versión final OK).
-- ============================================================================

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS vigencia_meses smallint;
COMMENT ON COLUMN public.servicios.vigencia_meses IS
  'Mig 0155 · meses de un ciclo del servicio. NULL = único, no genera vencimiento.';

UPDATE public.servicios SET vigencia_meses = 12
WHERE codigo IN ('rpac_renovacion','curso_actualizacion_rpac','rpac_ddjj');

UPDATE public.vencimientos
SET estado = 'cancelado'
WHERE tipo IN ('certificado_arca','habilitacion_municipal','libro_actas',
               'libro_administracion','revision_ascensor','seguro_consorcio')
  AND estado <> 'cancelado';

ALTER TABLE public.vencimientos DROP CONSTRAINT IF EXISTS vencimientos_tipo_check;
UPDATE public.vencimientos SET tipo = 'renovacion_rpac' WHERE tipo = 'matricula_rpac';
ALTER TABLE public.vencimientos
  ADD CONSTRAINT vencimientos_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'renovacion_rpac'::text,
    'curso_actualizacion'::text,
    'ddjj_anual'::text,
    'otro'::text
  ]));

-- vencimientos_config: borrar los descartados, dejar/updatear ddjj_anual,
-- insertar los 2 nuevos (renovacion_rpac, curso_actualizacion).
ALTER TABLE public.vencimientos_config DROP CONSTRAINT IF EXISTS vencimientos_config_tipo_check;

DELETE FROM public.vencimientos_config
WHERE tipo IN ('certificado_arca','habilitacion_municipal','libro_actas',
               'libro_administracion','revision_ascensor','seguro_consorcio',
               'matricula_rpac');

-- Actualizar el ddjj_anual existente con los nuevos defaults.
UPDATE public.vencimientos_config
SET dias_alerta_1 = 30, dias_alerta_2 = 20, dias_alerta_3 = 10,
    sugerencia_servicio_slug = 'ddjj-anual', activo = true
WHERE administracion_id IS NULL AND tipo = 'ddjj_anual';

-- Insertar los 2 nuevos sólo si no existen.
INSERT INTO public.vencimientos_config
  (administracion_id, tipo, dias_alerta_1, dias_alerta_2, dias_alerta_3, sugerencia_servicio_slug, activo)
SELECT NULL, 'renovacion_rpac', 30, 20, 10, 'renovacion-rpac', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.vencimientos_config
  WHERE administracion_id IS NULL AND tipo = 'renovacion_rpac'
);

INSERT INTO public.vencimientos_config
  (administracion_id, tipo, dias_alerta_1, dias_alerta_2, dias_alerta_3, sugerencia_servicio_slug, activo)
SELECT NULL, 'curso_actualizacion', 30, 20, 10, 'curso-actualizacion', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.vencimientos_config
  WHERE administracion_id IS NULL AND tipo = 'curso_actualizacion'
);

ALTER TABLE public.vencimientos_config
  ADD CONSTRAINT vencimientos_config_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'renovacion_rpac'::text,
    'curso_actualizacion'::text,
    'ddjj_anual'::text
  ]));

COMMENT ON TABLE public.vencimientos IS
  'Mig 0155 · Vencimientos SOLO de servicios contratados con GG con renovación '
  'periódica: renovacion_rpac, curso_actualizacion, ddjj_anual.';