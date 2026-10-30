-- 0620_dgg221_prospecto_renovacion_en_tramite.sql
-- DGG-221 · Captación — status "vencida pero en trámite" para prospectos.
-- --------------------------------------------------------------------------
-- Caso Bernardo Giles (reclamo real): su matrícula figura vencida (última
-- renovación INSCRIPTO 10/09/2025 → vence 10/09/2026), PERO ya empezó a renovar
-- por su cuenta (RENOVACION DE MATRICULA · INICIADO · 29/10/2026). El parser
-- (regla correcta: sólo INSCRIPTO cuenta) lo marca vencido, pero NO hay nada que
-- ofrecerle — ya está regularizando. Mandarle "tu matrícula venció / regularizá"
-- es mala imagen (decisión de Pablo). Solución:
--   (1) status propio "vencida pero en trámite" (flag en_tramite).
--   (2) el motor de captación NO le manda el mail de "vencida" (sí lo mantiene
--       en el universo para otras campañas de marketing).
--   (3) un cron lo revisita para, cuando su renovación pase a INSCRIPTO,
--       actualizar su fecha y sacarle el flag (lo resuelve mig/cron aparte).
--
-- Columnas aditivas (default false / NULL). El re-scrape con el parser nuevo
-- (tramix-prospectos / tramix-backfill) las puebla. ALTER ADD COLUMN sobre tabla
-- existente hereda sus GRANTs. No DDL de tablas nuevas.
-- --------------------------------------------------------------------------

-- Por matriculado (hija): ¿tiene una renovación iniciada MÁS NUEVA que su última
-- renovación INSCRIPTO? (= empezó a renovar, aún no otorgada).
ALTER TABLE public.prospecto_padron
  ADD COLUMN IF NOT EXISTS renovacion_en_tramite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS en_tramite_fecha date,
  ADD COLUMN IF NOT EXISTS en_tramite_estado text;

-- Rollup al prospecto (padre): true si CUALQUIER matrícula suya está en trámite.
-- Lo usa el motor para excluirlo del segmento "vencida".
ALTER TABLE public.prospectos
  ADD COLUMN IF NOT EXISTS en_tramite boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.prospecto_padron.renovacion_en_tramite IS
  'DGG-221: hay una RENOVACION DE MATRICULA más nueva que la última INSCRIPTO pero aún en proceso (INICIADO/etc.) → vencida pero en trámite.';
COMMENT ON COLUMN public.prospectos.en_tramite IS
  'DGG-221: rollup — true si alguna matrícula del prospecto está vencida-pero-en-trámite; el motor NO le manda el mail de "vencida".';
