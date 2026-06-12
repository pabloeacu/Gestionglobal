-- FIX (cazado por el §6 de la condición encuesta): matricula_sync_examen tenía el MISMO
-- bug latente que se arregló para la encuesta — su PERFORM emitir_certificado_si_corresponde
-- final estaba SIN proteger. Un alumno (no-staff) que cierra un examen que es la ÚLTIMA
-- condición de un curso con cert_emite_auto recibía 42501 'Solo gerencia...' y se le
-- rollbackeaba la respuesta del examen. (Hoy ningún curso real tiene examen-como-única-
-- condición + auto, pero es un landmine.) Se envuelve best-effort igual que 0228/0229.
CREATE OR REPLACE FUNCTION public.matricula_sync_examen(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso_id uuid; v_cond record; v_aprobado boolean;
BEGIN
  SELECT curso_id INTO v_curso_id FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_curso_id IS NULL THEN RETURN; END IF;
  FOR v_cond IN
    SELECT cc.id, cc.examen_id FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso_id AND cc.tipo = 'examen' AND cc.activa = true
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.examen_intentos ei
       JOIN public.curso_examenes ce ON ce.id = ei.examen_id
      WHERE ei.matricula_id = p_matricula_id AND ei.aprobado = true
        AND ce.curso_id = v_curso_id
        AND (v_cond.examen_id IS NULL OR ei.examen_id = v_cond.examen_id)
    ) INTO v_aprobado;
    IF v_aprobado THEN
      INSERT INTO public.matricula_condiciones
        (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por)
      VALUES (p_matricula_id, v_cond.id, true, now(), NULL)
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true,
            cumplida_at = COALESCE(public.matricula_condiciones.cumplida_at, now())
      WHERE public.matricula_condiciones.cumplida = false;
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.emitir_certificado_si_corresponde(p_matricula_id);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort; el cron emite si el guard bloqueó (alumno no-staff)
  END;
END;
$function$;
