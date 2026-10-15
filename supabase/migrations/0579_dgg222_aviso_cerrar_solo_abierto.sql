-- 0579 · DGG-222/E-GG — el aviso "Listo para cerrar" (DGG-147) NO debe dispararse
-- si el trámite ya está CERRADO.
--
-- Caso real (TRM-2026-00081, Di Benedetto): el agente de cierre automático (DGG-222)
-- cerró el trámite el 14/10 (con la gracia vigente y el certificado >30d, cierre
-- legítimo). Después venció la gracia → la matrícula pasó a 'vencida' → el trigger
-- `trg_matricula_completada_avisa_fn` (que dispara al fin de gracia) mandó el aviso
-- "Listo para cerrar" el 15/10 01:25 — pero el trámite YA estaba cerrado. Resultado:
-- se le avisa a gerencia que cierre algo que el agente ya cerró (ruido/confusión).
--
-- Fix: antes de avisar, verificar que el trámite asociado siga ABIERTO/RESUELTO
-- (no 'cerrado'/'anulado'). Si no hay tramite_id (curso sin trámite), se avisa igual.
-- Resto de la lógica idéntica (mismo gate de fin de gracia).

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
  v_dispara boolean;
  v_cuerpo text;
BEGIN
  -- Espejo del gate del asistente (DGG-147): fin de gracia o sin ventana.
  v_dispara :=
    (NEW.estado = 'vencida' AND OLD.estado IS DISTINCT FROM 'vencida')
    OR (NEW.estado = 'completada' AND OLD.estado IS DISTINCT FROM 'completada'
        AND NEW.vigencia_hasta IS NULL);

  -- DGG-222 (2026-10-15): no avisar si el trámite ya fue cerrado (p.ej. por el
  -- agente de cierre automático antes de que venza la gracia) o anulado.
  IF v_dispara AND NEW.tramite_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tramites t
                 WHERE t.id = NEW.tramite_id AND t.estado IN ('cerrado', 'anulado')) THEN
    v_dispara := false;
  END IF;

  IF v_dispara THEN
    SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = NEW.curso_id;
    SELECT a.nombre INTO v_admin FROM public.administraciones a WHERE a.id = NEW.administracion_id;
    v_url := CASE WHEN NEW.tramite_id IS NOT NULL
                  THEN '/gerencia/trackings/' || NEW.tramite_id::text
                  ELSE '/gerencia/campus/' || NEW.curso_id::text END;

    v_cuerpo := COALESCE(v_admin, 'El alumno') || ' terminó «' || COALESCE(v_curso, 'su curso') || '»'
      || CASE WHEN NEW.estado = 'vencida'
              THEN ' y su plazo de gracia finalizó.'
              ELSE '.' END
      || ' Ya podés cerrar el trámite y programar el próximo vencimiento desde el detalle.';

    PERFORM public.notify_all_gerentes(
      'matricula_completada',
      '🎓 Listo para cerrar · ' || COALESCE(v_admin, 'Alumno'),
      v_cuerpo,
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

REVOKE ALL ON FUNCTION public.trg_matricula_completada_avisa_fn() FROM PUBLIC, anon, authenticated;
