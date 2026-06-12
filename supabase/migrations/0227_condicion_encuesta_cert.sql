-- "Encuesta" como condición configurable del certificado (cursos).
-- (1) nuevo tipo 'encuesta' en curso_condiciones_config.
-- (2) el gate matricula_cumple_encuesta bloquea si hay flag requerida_para_cert O una
--     condición 'encuesta' activa, y el alumno no respondió.
-- (3) matricula_sync_encuesta + trigger en curso_encuesta_respuestas → marca la condición
--     cumplida + re-dispara la emisión (arregla el gap: responder la encuesta no
--     auto-emitía el certificado, ni siquiera para cursos con sólo el flag).

-- 1) tipo 'encuesta'
ALTER TABLE public.curso_condiciones_config DROP CONSTRAINT IF EXISTS curso_condiciones_config_tipo_check;
ALTER TABLE public.curso_condiciones_config ADD CONSTRAINT curso_condiciones_config_tipo_check
  CHECK (tipo = ANY (ARRAY['examen','asistencia','pago','otra','encuesta']));

-- 2) gate: honra el flag O la condición 'encuesta' activa
CREATE OR REPLACE FUNCTION public.matricula_cumple_encuesta(p_matricula_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_es_dueno boolean;
BEGIN
  IF NOT private.is_staff() THEN
    SELECT EXISTS (SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id AND m.profile_id = auth.uid())
      INTO v_es_dueno;
    IF NOT v_es_dueno THEN
      RAISE EXCEPTION 'no_access: matrícula no pertenece al usuario' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m
    JOIN public.curso_encuestas e ON e.curso_id = m.curso_id
    WHERE m.id = p_matricula_id
      AND e.activa
      AND (
        e.requerida_para_cert
        OR EXISTS (SELECT 1 FROM public.curso_condiciones_config cc
                   WHERE cc.curso_id = m.curso_id AND cc.tipo = 'encuesta' AND cc.activa)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.curso_encuesta_respuestas r
        WHERE r.matricula_id = m.id AND r.encuesta_id = e.id
      )
  );
END;
$function$;

-- 3) sync de la condición 'encuesta' al responder (mirror de matricula_sync_examen) +
--    re-dispara la emisión (también arregla el gap para cursos con sólo el flag).
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
  PERFORM public.emitir_certificado_si_corresponde(p_matricula_id);
END;
$function$;

-- trigger: responder/actualizar la encuesta → sync + emisión
CREATE OR REPLACE FUNCTION public.tg_encuesta_respuesta_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  PERFORM public.matricula_sync_encuesta(NEW.matricula_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_encuesta_respuesta_sync ON public.curso_encuesta_respuestas;
CREATE TRIGGER trg_encuesta_respuesta_sync
  AFTER INSERT OR UPDATE ON public.curso_encuesta_respuestas
  FOR EACH ROW EXECUTE FUNCTION public.tg_encuesta_respuesta_sync();

REVOKE EXECUTE ON FUNCTION public.matricula_sync_encuesta(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_encuesta_respuesta_sync() FROM PUBLIC, anon, authenticated;
