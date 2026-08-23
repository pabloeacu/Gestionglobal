-- 0453_dgg147_aviso_cerrar_al_fin_de_gracia.sql
-- DGG-147 (§6 A1) · 2026-08-23
--
-- Pablo: "el aviso [de cerrar el trámite] no tiene que estar cuando hacen el
-- examen… cuando termina el plazo de gracia ENTONCES aparecer el aviso".
--
-- El trigger `trg_matricula_completada_avisa` (mig 0437) mandaba
-- campanita+push+email a gerencia al pasar la matrícula a 'completada' (INICIO
-- del plazo de gracia) diciendo "arrancó su plazo de gracia. Cerrá el trámite
-- … desde el detalle". Con DGG-147 el asistente de cierre del detalle ya NO
-- aparece durante la gracia → el aviso llevaba a un detalle sin el botón.
--
-- Fix: el aviso se emite cuando la gracia TERMINA — espejo EXACTO del gate del
-- asistente (TrackingDetailPage): estado='vencida' (el cron
-- `gg-campus-matriculas-vencer` lo setea al expirar vigencia_hasta) O
-- estado='completada' sin vigencia_hasta (curso sin ventana de repaso /
-- grandfather: el cron nunca las pasa a 'vencida', así que el aviso — como el
-- asistente — sale al completarse). Durante la gracia vigente: sin aviso.
-- El trigger sigue AFTER UPDATE OF estado (el flip del cron lo dispara).
-- CREATE OR REPLACE de la función (misma firma) — regla 16 no aplica.

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
