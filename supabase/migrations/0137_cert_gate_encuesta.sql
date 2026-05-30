-- ============================================================================
-- Mig 0137 · Gate de encuesta en el motor de certificados (extiende 0087).
-- Si el curso tiene encuesta activa+requerida y la matrícula NO respondió,
-- el cert no se emite (ni el motor automático, ni el manual de gerencia).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emitir_certificado_si_corresponde(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer; v_cumplidas integer; v_existe uuid;
  v_curso_id uuid; v_auto boolean;
BEGIN
  SELECT id INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT m.curso_id INTO v_curso_id FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  SELECT cert_emite_auto INTO v_auto FROM public.cursos WHERE id = v_curso_id;
  IF NOT COALESCE(v_auto, true) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida)
    INTO v_total, v_cumplidas
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;
  IF v_total IS NULL OR v_total = 0 OR v_cumplidas < v_total THEN
    RETURN NULL;
  END IF;

  -- Mig 0137: gate de encuesta. Si requiere encuesta y no respondió, NO emitir.
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RETURN NULL;
  END IF;

  RETURN public.emitir_certificado(p_matricula_id);
END;
$$;

-- También endurecer el RPC manual: gerencia no puede emitir si falta encuesta.
CREATE OR REPLACE FUNCTION public.emitir_certificado(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe uuid; v_curso_id uuid; v_codigo text; v_cert_id uuid;
  v_esquema_id uuid; v_esquema_snap jsonb;
BEGIN
  SELECT id INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT m.curso_id INTO v_curso_id FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'Matrícula no existe' USING ERRCODE = '22023';
  END IF;

  -- Mig 0137: si la encuesta es requerida y no fue respondida, bloquear.
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RAISE EXCEPTION 'No se puede emitir: el alumno todavía no respondió la encuesta de satisfacción (requerida para este curso).'
      USING ERRCODE = '22023';
  END IF;

  SELECT cert_esquema_id INTO v_esquema_id FROM public.cursos WHERE id = v_curso_id;
  IF v_esquema_id IS NOT NULL THEN
    SELECT to_jsonb(e.*) INTO v_esquema_snap
      FROM public.certificado_esquemas e WHERE e.id = v_esquema_id;
  END IF;

  v_codigo := 'GG-FORM-' || to_char(NOW(),'YYYY') || '-' || upper(substring(md5(p_matricula_id::text || NOW()::text) from 1 for 6));

  INSERT INTO public.certificados (matricula_id, codigo, esquema_id, esquema_snapshot, emitido_at)
  VALUES (p_matricula_id, v_codigo, v_esquema_id, v_esquema_snap, NOW())
  RETURNING id INTO v_cert_id;

  RETURN v_cert_id;
END;
$$;
