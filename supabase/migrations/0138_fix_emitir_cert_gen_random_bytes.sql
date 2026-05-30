-- ============================================================================
-- Mig 0138 · Hotfix interno: la mig 0137 dejó en emitir_certificado una línea
-- muerta con public.gen_random_bytes(6) que NO está en search_path =
-- public,pg_temp (vive en extensions). Aunque venía un fallback md5 una línea
-- después, el código nunca llegaba porque la primera asignación crasheaba en
-- runtime con 42883. Eliminamos la línea muerta.
--
-- Nota: esta migración fue obsoletada inmediatamente por la 0139, que además
-- restaura el INSERT completo de 0087 (esquema_id no existe, hace falta
-- payload_snapshot + esquema_snapshot + email). Se mantiene este archivo para
-- que el orden de migraciones aplicadas en producción coincida con el repo.
-- ============================================================================

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
