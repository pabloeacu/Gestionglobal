-- FIX (causa raíz del bug cazado en el live test): trg_condicion_cumplida_emitir (sobre
-- matricula_condiciones) llamaba a emitir_certificado_si_corresponde SIN protección. Cuando
-- el alumno (no-staff) completa la ÚLTIMA condición (p.ej. la encuesta), emitir_certificado
-- bloquea con 42501 'Solo gerencia...' y el error revienta el marcado de la condición (y la
-- respuesta de la encuesta). Bug latente preexistente (afectaba también examen-última-
-- condición con cert_emite_auto). El cron gg-campus-certificados (cada 5 min, auth nula) ya
-- emite sin guard. Hacemos la emisión síncrona BEST-EFFORT: marcar la condición nunca falla;
-- gerencia emite al instante, alumno emite vía cron en ≤5 min.
CREATE OR REPLACE FUNCTION public.trg_condicion_cumplida_emitir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.cumplida = true AND COALESCE(OLD.cumplida, false) = false THEN
    BEGIN
      PERFORM public.emitir_certificado_si_corresponde(NEW.matricula_id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort; el cron emite si el guard bloqueó (alumno no-staff)
    END;
  END IF;
  RETURN NEW;
END;
$function$;
