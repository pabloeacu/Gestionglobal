-- 0316 · Auditoría proactiva (ciclo de vida) · las RPCs de escritura de campus
-- (curso_iniciar_intento, curso_marcar_clase_completada) validaban ownership pero
-- NO el estado de la matrícula → un alumno con matrícula VENCIDA/anulada podía
-- iniciar intentos y marcar clases por API directa (el gate de lectura sí lo tapa).
-- Agregamos el chequeo de vigencia (misma lógica que private.curso_matriculado).
-- Bloquear iniciar_intento cierra el examen (responder_examen requiere un intento
-- que ya no se puede crear). Misma firma → CREATE OR REPLACE (R16).
CREATE OR REPLACE FUNCTION public.curso_iniciar_intento(p_examen_id uuid, p_matricula_id uuid)
 RETURNS examen_intentos LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid; v_next smallint; v_row public.examen_intentos;
BEGIN
  SELECT profile_id INTO v_owner FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023'; END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() AND NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id
      AND (m.estado='activa' OR (m.estado='completada' AND (m.vigencia_hasta IS NULL
            OR m.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))
  ) THEN
    RAISE EXCEPTION 'Tu acceso a este curso no está vigente (matrícula vencida o dada de baja).' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_matricula_id::text || ':' || p_examen_id::text));
  SELECT COALESCE(max(intento), 0) + 1 INTO v_next
    FROM public.examen_intentos WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id;
  INSERT INTO public.examen_intentos (matricula_id, examen_id, intento)
  VALUES (p_matricula_id, p_examen_id, v_next) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.curso_marcar_clase_completada(p_matricula_id uuid, p_clase_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid;
BEGIN
  SELECT profile_id INTO v_owner FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Matricula inexistente' USING ERRCODE = '22023'; END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() AND NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id
      AND (m.estado='activa' OR (m.estado='completada' AND (m.vigencia_hasta IS NULL
            OR m.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))
  ) THEN
    RAISE EXCEPTION 'Tu acceso a este curso no está vigente (matrícula vencida o dada de baja).' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.curso_progreso (matricula_id, clase_id, completada, completada_at)
  VALUES (p_matricula_id, p_clase_id, true, now())
  ON CONFLICT (matricula_id, clase_id)
    DO UPDATE SET completada = true, completada_at = COALESCE(public.curso_progreso.completada_at, now());
END;
$function$;
