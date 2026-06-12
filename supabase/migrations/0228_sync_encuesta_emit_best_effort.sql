-- FIX (cazado por el live test con QA alumno): cuando el ALUMNO (no-staff) responde la
-- encuesta, el trigger disparaba emitir_certificado_si_corresponde → emitir_certificado,
-- que tiene guard 'auth.uid() IS NOT NULL AND NOT is_staff()' → RAISE 42501. El error
-- reventaba la respuesta de la encuesta (rollback). El diseño del sistema ya delega la
-- auto-emisión del alumno al cron gg-campus-certificados (cada 5 min, auth nula → sin
-- guard). Hacemos la emisión síncrona BEST-EFFORT en matricula_sync_encuesta.
-- (El fix de causa raíz está en 0229: trg_condicion_cumplida_emitir; éste es defensa extra.)
CREATE OR REPLACE FUNCTION public.matricula_sync_encuesta(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_curso_id uuid; v_cond record; v_respondio boolean;
BEGIN
  SELECT curso_id INTO v_curso_id FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_curso_id IS NULL THEN RETURN; END IF;
  FOR v_cond IN
    SELECT cc.id FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso_id AND cc.tipo = 'encuesta' AND cc.activa = true
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.curso_encuesta_respuestas r
       JOIN public.curso_encuestas e ON e.id = r.encuesta_id
      WHERE r.matricula_id = p_matricula_id AND e.curso_id = v_curso_id
    ) INTO v_respondio;
    IF v_respondio THEN
      INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por)
      VALUES (p_matricula_id, v_cond.id, true, now(), NULL)
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true, cumplida_at = COALESCE(public.matricula_condiciones.cumplida_at, now())
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
REVOKE EXECUTE ON FUNCTION public.matricula_sync_encuesta(uuid) FROM PUBLIC, anon, authenticated;
