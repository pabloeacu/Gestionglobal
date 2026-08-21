-- 0436_dgg142e2_cron_sin_cierre_y_regla_b_vencimiento.sql
-- DGG-142 Etapa 2 (parte A) + DGG-143 Regla B · 2026-08-21
--
-- (1) CRON SIN PASO DE CIERRE. `gg_campus_vencer_matriculas` (mig 0253)
--     intentaba cerrar trámites de curso matcheando
--     `m.submission_origen = t.formulario_submission_id` — vínculo que NUNCA
--     existió (columna sin escritor, 56/56 NULL): el paso está muerto desde
--     el día 1 y además contradice la doctrina DGG-142 ("resuelto es manual;
--     los automatismos avisan, el humano decide"). Se elimina: el cron sólo
--     vence el acceso (completada → vencida). El cierre del trámite pasa a
--     ser el ASISTENTE con humano (Etapa 2 parte B). Riesgo cero: se apaga
--     algo que jamás ejecutó un cierre. Bonus: elimina 1 de las 2 referencias
--     vivas a `submission_origen` (queda sólo el trigger del cert, mig 0253A,
--     también muerto — se limpia en la Etapa 2B).
--
-- (2) REGLA B (DGG-143, pedido explícito de Pablo): el campo
--     `administraciones.matricula_rpac_vencimiento` NUNCA queda vacío tras
--     una matriculación/renovación. Al pasar a 'cerrado' un trámite cuyo
--     servicio es Inscripción al RPAC o Renovación de matrícula RPAC, si el
--     campo está NULL → se asigna fecha de cierre + 12 meses (aniversario).
--     Cualquier carga previa (gerencia/cliente/gestoría) manda sobre el
--     default (sólo rellena si está vacío). Automatismo explícitamente
--     pedido: rellena un dato, no toma decisiones de negocio.
--     R17: el trigger escribe en `administraciones` (RLS) → SECURITY DEFINER.

-- ── (1) Cron: sólo vencer acceso ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gg_campus_vencer_matriculas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Vencer el acceso al campus (fin del plazo de gracia, DGG-82/DGG-142).
  UPDATE public.curso_matriculas
     SET estado = 'vencida', updated_at = now()
   WHERE estado = 'completada'
     AND vigencia_hasta IS NOT NULL
     AND vigencia_hasta < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

  -- DGG-142 E2: el paso de cierre de trámites (DGG-88) se ELIMINÓ — estaba
  -- muerto (submission_origen sin escritor) y contradecía la doctrina
  -- "resuelto es manual". El cierre lo hace gerencia vía el asistente.
END;
$$;

REVOKE ALL ON FUNCTION public.gg_campus_vencer_matriculas() FROM PUBLIC, anon, authenticated;

-- ── (2) Regla B: vencimiento de matrícula nunca vacío ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Sólo transición a 'cerrado' de trámites de matrícula RPAC (alta o renovación).
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado'
     AND NEW.administracion_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.servicios s
        WHERE s.id = NEW.servicio_id
          -- §6 E2: match por codigo ESTABLE (el nombre es editable por UI y
          -- este mismo chunk renombró un servicio — mig 0435).
          AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
     )
  THEN
    UPDATE public.administraciones
       -- §6 E2: fecha en calendario ARGENTINA (la BD corre en UTC; un cierre
       -- 21:00-23:59 ART caía en el día UTC siguiente). Convención 0245/0253.
       SET matricula_rpac_vencimiento =
             ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
               + INTERVAL '12 months')::date,
           updated_at = now()
     WHERE id = NEW.administracion_id
       AND matricula_rpac_vencimiento IS NULL; -- sólo rellena si está vacío
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort: jamás abortar el cierre del trámite por esto.
  RAISE WARNING 'trg_tramite_cierre_setea_vencimiento fallo: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tramite_cierre_setea_vencimiento ON public.tramites;
CREATE TRIGGER trg_tramite_cierre_setea_vencimiento
  AFTER UPDATE OF estado ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn();

REVOKE ALL ON FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- SMOKES (vía MCP tras aplicar):
--   R18 e2e: BEGIN → tramite sintético servicio 'Inscripción al RPAC' →
--   estado='cerrado' → administraciones.matricula_rpac_vencimiento =
--   hoy+12m (si estaba NULL); con campo YA cargado → NO pisa; servicio no
--   matrícula → no toca. gg_campus_vencer_matriculas() → sólo vence, 0
--   trámites tocados. ROLLBACK.
--   R17: trigger SECURITY DEFINER (escribe administraciones con RLS) ✓.
-- ----------------------------------------------------------------------------
