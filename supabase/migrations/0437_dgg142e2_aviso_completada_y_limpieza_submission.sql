-- 0437_dgg142e2_aviso_completada_y_limpieza_submission.sql
-- DGG-142 Etapa 2 (parte B-backend) · 2026-08-21
--
-- (1) LIMPIEZA FINAL de `submission_origen`. Tras la mig 0436 (cron sin paso
--     de cierre), la ÚNICA referencia viva que quedaba era el trigger
--     `trg_certificado_cierra_tramite_curso` (mig 0253A: al emitirse un cert
--     ponía el trámite en 'resuelto' vía submission match — NUNCA ejecutó,
--     submission siempre NULL, y contradice la doctrina DGG-142/143:
--     "resuelto lo asigna gerencia manualmente"). Se dropea trigger + función
--     y LUEGO la columna (patrón E-GG-42: jamás dropear una columna con
--     funciones plpgsql vivas que la referencien). Verificado en prod:
--     0 funciones restantes la referencian tras este drop.
--
-- (2) AVISO "MATRÍCULA COMPLETADA" → asistente. Cuando una matrícula pasa a
--     'completada' (el alumno terminó: se emitió su certificado), gerencia
--     recibe campanita+push+email con link directo al TRÁMITE vinculado
--     (DGG-142 E1) para cerrar el ciclo con el asistente: cerrar trámite +
--     programar próximo vencimiento. La máquina AVISA, el humano decide.
--     R17: escribe en notificaciones vía notify_all_gerentes → SECURITY
--     DEFINER. Best-effort: jamás aborta la transacción del certificado.

-- ── (1) Drop del auto-resuelto muerto + columna ──────────────────────────────
DROP TRIGGER IF EXISTS trg_certificado_cierra_tramite_curso ON public.certificados;
DROP FUNCTION IF EXISTS public.trg_certificado_cierra_tramite_curso_fn();

ALTER TABLE public.curso_matriculas DROP COLUMN IF EXISTS submission_origen;

-- ── (2) Aviso a gerencia al completarse una matrícula ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_matricula_completada_avisa_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_curso text;
  v_admin text;
  v_url text;
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado IS DISTINCT FROM 'completada' THEN
    SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = NEW.curso_id;
    SELECT a.nombre INTO v_admin FROM public.administraciones a WHERE a.id = NEW.administracion_id;
    v_url := CASE WHEN NEW.tramite_id IS NOT NULL
                  THEN '/gerencia/trackings/' || NEW.tramite_id::text
                  ELSE '/gerencia/campus/' || NEW.curso_id::text END;

    PERFORM public.notify_all_gerentes(
      'matricula_completada',
      '🎓 Curso completado · ' || COALESCE(v_admin, 'Alumno'),
      COALESCE(v_admin, 'El alumno') || ' terminó «' || COALESCE(v_curso, 'su curso')
        || '» y arrancó su plazo de gracia. Cerrá el trámite y programá el próximo vencimiento desde el detalle.',
      v_url,
      jsonb_build_object('matricula_id', NEW.id, 'curso_id', NEW.curso_id,
                         'tramite_id', NEW.tramite_id),
      true,
      'gerencia-notif-generica',
      NULL, 2::smallint,
      'curso_matriculas', NEW.id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_matricula_completada_avisa fallo: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matricula_completada_avisa ON public.curso_matriculas;
CREATE TRIGGER trg_matricula_completada_avisa
  AFTER UPDATE OF estado ON public.curso_matriculas
  FOR EACH ROW EXECUTE FUNCTION public.trg_matricula_completada_avisa_fn();

REVOKE ALL ON FUNCTION public.trg_matricula_completada_avisa_fn() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- SMOKES (vía MCP tras aplicar):
--   · 0 funciones en pg_proc que referencien submission_origen; columna fuera.
--   · e2e DO $$: matrícula activa→completada → notificación 'matricula_completada'
--     creada con URL al trámite vinculado; ROLLBACK.
-- ----------------------------------------------------------------------------
