-- ============================================================================
-- Mig 0151 · B1 · Drop final tabla `agenda_eventos` deprecada
--
-- La tabla `agenda_eventos` fue creada en mig 0037 y deprecada en mig 0038
-- (Ronda 5.5 · patrón MDC). Reemplazada por `agenda_events` (owner-based).
-- Hoy: 0 filas, ya nadie escribe (cron desactivado 0038), nadie la lee
-- (vw_agenda_unificada usa agenda_events). El último vínculo vivo es el
-- trigger `trg_agenda_from_vencimiento` que sigue intentando insertar — hay
-- que dropearlo antes que la tabla.
--
-- Orden:
--   1. Dropear trigger + function privada.
--   2. Dropear RPCs públicas legacy (listar_eventos_agenda).
--   3. Dropear function privada del cron (encolar_recordatorios_agenda).
--   4. Dropear policies + tabla (CASCADE limpia el resto).
-- ============================================================================

-- 1. trigger + función
DROP TRIGGER IF EXISTS trg_agenda_from_vencimiento ON public.vencimientos;
DROP FUNCTION IF EXISTS private.agenda_from_vencimiento_threshold() CASCADE;

-- 2. RPCs públicas legacy
DROP FUNCTION IF EXISTS public.listar_eventos_agenda(date, date) CASCADE;
DROP FUNCTION IF EXISTS public.listar_eventos_agenda(timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.listar_eventos_agenda() CASCADE;

-- 3. function privada del cron desactivado
DROP FUNCTION IF EXISTS private.encolar_recordatorios_agenda() CASCADE;

-- 4. tabla (CASCADE limpia policies, índices, triggers internos)
DROP TABLE IF EXISTS public.agenda_eventos CASCADE;