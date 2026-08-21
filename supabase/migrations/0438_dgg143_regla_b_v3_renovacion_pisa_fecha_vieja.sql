-- 0438_dgg143_regla_b_v3_renovacion_pisa_fecha_vieja.sql
-- DGG-143 · Regla B v3 (decisión Pablo, 2026-08-21 — resuelve el PENDIENTE
-- del §6 E2): "la fecha de vencimiento de la matrícula es fluida (trámite
-- anual). Al cerrar una RENOVACIÓN que prosperó no puede quedar una fecha
-- vencida. Si al cierre existe una fecha del AÑO SIGUIENTE al calendario del
-- trámite, la ingresó el gerente a mano y es válida (conservar). Si es del
-- MISMO año (o anterior), es el resto de la renovación previa y se PISA con
-- cierre + 12 meses. Excepción: cierres por rechazo del RPAC (ajenos a
-- nosotros) no tocan nada" → gate por cierre_satisfactorio = false.
--
-- Resumen v3 (transición a 'cerrado' de servicios de matrícula RPAC):
--   · campo VACÍO → rellena cierre+12m (v1/v2, cualquiera de los 3 servicios)
--   · RENOVACIÓN satisfactoria + fecha existente de año <= año del cierre
--     → PISA con cierre+12m (fecha vieja de la renovación previa)
--   · fecha de año > año del cierre → conserva (cargada a mano, válida)
--   · cierre_satisfactorio = false → nunca pisa (rechazo RPAC/excepción)
-- Fechas SIEMPRE en calendario ART (§6 E2). Best-effort: jamás aborta el cierre.

CREATE OR REPLACE FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy_ar date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_nueva date := ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                    + INTERVAL '12 months')::date;
  v_codigo text;
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado'
     AND NEW.administracion_id IS NOT NULL THEN

    SELECT s.codigo INTO v_codigo FROM public.servicios s WHERE s.id = NEW.servicio_id;

    IF v_codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
      -- (1) Campo vacío → rellenar (regla original, los 3 servicios).
      UPDATE public.administraciones
         SET matricula_rpac_vencimiento = v_nueva, updated_at = now()
       WHERE id = NEW.administracion_id
         AND matricula_rpac_vencimiento IS NULL;

      -- (2) RENOVACIÓN que prosperó + fecha existente del mismo año (o
      --     anterior) al del cierre → es la fecha de la renovación previa:
      --     se pisa. Año siguiente → la cargó el gerente a mano: se conserva.
      IF v_codigo = 'rpac_renovacion'
         AND NEW.cierre_satisfactorio IS DISTINCT FROM false THEN
        UPDATE public.administraciones
           SET matricula_rpac_vencimiento = v_nueva, updated_at = now()
         WHERE id = NEW.administracion_id
           AND matricula_rpac_vencimiento IS NOT NULL
           AND EXTRACT(YEAR FROM matricula_rpac_vencimiento)
               <= EXTRACT(YEAR FROM v_hoy_ar);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_tramite_cierre_setea_vencimiento fallo: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- SMOKES (vía MCP tras aplicar, DO $$ ... ROLLBACK):
--   R1 renovación satisfactoria + fecha mismo año  → PISA a hoy+12m
--   R2 renovación + fecha año siguiente            → conserva
--   R3 renovación cierre_satisfactorio=false       → conserva (rechazo RPAC)
--   R4 inscripción con fecha cargada               → conserva (sólo rellena)
--   R5 campo NULL                                  → rellena
-- ----------------------------------------------------------------------------
