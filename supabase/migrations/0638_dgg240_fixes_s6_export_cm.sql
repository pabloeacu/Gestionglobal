-- 0638_dgg240_fixes_s6_export_cm.sql
-- DGG-240 · fixes de la doble auditoría §6 (3 agentes) del export de encuestas:
--   • commit NO avanza el reloj salvo entrega garantizada (overall ok/sin_novedad)
--     → cierra la pérdida silenciosa en sin_destinatarios / adjunto demasiado
--       grande (el edge pasa p_error en ese caso). [A#1/A#2/B#2/B#3/C#1]
--   • idempotencia optimista (FOR UPDATE + cubierto_hasta == p_desde) → sin
--     digest duplicado si el cron y "Enviar ahora" coinciden. [A#3]
--   • valida formato de email + DISTINCT antes de encolar. [A#4/B#6/C#10]
--   • encuesta_export_dataset: guard is_staff (no sólo gerente) → paridad con la
--     RLS de las encuestas (gerente + operador las ven y pueden exportar). [A#5]
--   • índice btree en curso_encuesta_respuestas(created_at) para el range-scan
--     de la ventana. [A#6/R11]
-- R16: DROP antes de CREATE (sin overloads). La firma de commit gana p_error.

-- ============================================================================
-- Índice del range-scan por fecha (R11)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_cer_created_at
  ON public.curso_encuesta_respuestas (created_at);

-- ============================================================================
-- encuesta_export_dataset — guard a is_staff (gerente + operador) · R16
-- ============================================================================
DROP FUNCTION IF EXISTS public.encuesta_export_dataset(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.encuesta_export_dataset(
  p_desde timestamptz, p_hasta timestamptz, p_encuesta_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT (private.is_staff() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  WITH encuestas_sel AS (
    SELECT e.id, e.titulo, e.curso_id, e.schema, c.titulo AS curso_titulo
    FROM public.curso_encuestas e
    LEFT JOIN public.cursos c ON c.id = e.curso_id
    WHERE (p_encuesta_id IS NOT NULL AND e.id = p_encuesta_id)
       OR (p_encuesta_id IS NULL AND EXISTS (
             SELECT 1 FROM public.curso_encuesta_respuestas r
             WHERE r.encuesta_id = e.id
               AND r.created_at >= COALESCE(p_desde, '-infinity'::timestamptz)
               AND r.created_at <  p_hasta))
  ),
  resp AS (
    SELECT r.encuesta_id, r.created_at, r.permite_publicar,
      jsonb_build_object(
        'id', r.id, 'fecha', r.created_at, 'alumno_nombre', pr.full_name,
        'respuestas', r.respuestas, 'permite_publicar', r.permite_publicar,
        'publicado', r.publicado, 'testimonio_nombre', r.testimonio_nombre,
        'testimonio_comentario', r.testimonio_comentario, 'testimonio_foto_url', r.testimonio_foto_url
      ) AS row_json
    FROM public.curso_encuesta_respuestas r
    JOIN encuestas_sel es ON es.id = r.encuesta_id
    LEFT JOIN public.curso_matriculas m ON m.id = r.matricula_id
    LEFT JOIN public.profiles pr ON pr.id = m.profile_id
    WHERE r.created_at >= COALESCE(p_desde, '-infinity'::timestamptz) AND r.created_at < p_hasta
  ),
  por_curso AS (
    SELECT es.id, es.titulo, es.curso_titulo, es.schema,
      count(rr.row_json) AS total,
      count(rr.row_json) FILTER (WHERE rr.permite_publicar) AS publicables,
      COALESCE(jsonb_agg(rr.row_json ORDER BY rr.created_at DESC) FILTER (WHERE rr.row_json IS NOT NULL), '[]'::jsonb) AS respuestas
    FROM encuestas_sel es
    LEFT JOIN resp rr ON rr.encuesta_id = es.id
    GROUP BY es.id, es.titulo, es.curso_titulo, es.schema
  )
  SELECT jsonb_build_object(
    'generado_at', now(), 'desde', p_desde, 'hasta', p_hasta,
    'cursos', COALESCE(jsonb_agg(
      jsonb_build_object('encuesta_id', pc.id, 'titulo', pc.titulo, 'curso_titulo', pc.curso_titulo,
        'preguntas', COALESCE(pc.schema->'preguntas', '[]'::jsonb),
        'total', pc.total, 'publicables', pc.publicables, 'respuestas', pc.respuestas
      ) ORDER BY pc.total DESC), '[]'::jsonb)
  ) INTO v_result FROM por_curso pc;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.encuesta_export_dataset(timestamptz, timestamptz, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_export_dataset(timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ============================================================================
-- encuesta_cm_commit — reloj sólo con entrega garantizada + idempotencia +
--   validación de emails. Nueva firma con p_error. · R16 (DROP + CREATE)
-- ============================================================================
DROP FUNCTION IF EXISTS public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb);
CREATE FUNCTION public.encuesta_cm_commit(
  p_origen text, p_corte timestamptz, p_desde timestamptz, p_bucket text,
  p_pdf_path text, p_xlsx_path text, p_pdf_filename text, p_xlsx_filename text,
  p_resumen jsonb, p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cur timestamptz; v_emails text; v_lista text[]; v_email text;
  v_destinatarios text[] := '{}'; v_overall text;
  v_cursos integer := COALESCE((p_resumen->>'cursos')::integer, 0);
  v_resp integer := COALESCE((p_resumen->>'respuestas')::integer, 0);
  v_pub integer := COALESCE((p_resumen->>'publicables')::integer, 0);
  v_vars jsonb; v_att jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Lock de la fila singleton + idempotencia optimista (A#3): si otra corrida ya
  -- avanzó el reloj desde que el edge leyó la ventana, abortamos SIN encolar.
  SELECT encuesta_cm_cubierto_hasta, encuesta_cm_emails
    INTO v_cur, v_emails
  FROM public.config_global WHERE id = 1 FOR UPDATE;
  IF v_cur IS DISTINCT FROM p_desde THEN
    RETURN jsonb_build_object('ok', true, 'overall', 'ya_procesado', 'destinatarios', '[]'::jsonb);
  END IF;

  IF p_error IS NOT NULL THEN
    v_overall := 'error';                 -- adjunto demasiado grande / fallo de generación
  ELSIF p_pdf_path IS NOT NULL THEN
    -- tokens únicos, no vacíos, con formato de email válido (A#4/B#6/C#10)
    v_lista := ARRAY(
      SELECT DISTINCT lower(btrim(e))
      FROM unnest(regexp_split_to_array(COALESCE(v_emails, ''), '[;,\s]+')) AS e
      WHERE btrim(e) <> ''
        AND lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    );
    IF array_length(v_lista, 1) IS NULL THEN
      v_overall := 'sin_destinatarios';
    ELSE
      v_overall := 'ok';
      v_vars := jsonb_build_object('periodo', COALESCE(p_resumen->>'periodo_label', ''),
        'cursos', v_cursos::text, 'respuestas', v_resp::text, 'publicables', v_pub::text);
      v_att := jsonb_build_array(
        jsonb_build_object('filename', p_pdf_filename, 'storage_bucket', p_bucket, 'storage_path', p_pdf_path, 'content_type', 'application/pdf'),
        jsonb_build_object('filename', p_xlsx_filename, 'storage_bucket', p_bucket, 'storage_path', p_xlsx_path, 'content_type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      );
      FOREACH v_email IN ARRAY v_lista LOOP
        INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, attachments_jsonb, prioridad, related_table, programado_para)
        VALUES ('workflow', 'encuesta-cm-digest', v_email, 'Community Manager', v_vars, v_att, 5, 'curso_encuestas', now());
        v_destinatarios := array_append(v_destinatarios, v_email);
      END LOOP;
    END IF;
  ELSE
    v_overall := 'sin_novedad';
  END IF;

  -- Avanza el reloj SÓLO con entrega garantizada o nada que entregar (A#1/A#2).
  IF v_overall IN ('ok', 'sin_novedad') THEN
    UPDATE public.config_global
       SET encuesta_cm_cubierto_hasta = p_corte, encuesta_cm_ultimo_envio_at = now()
     WHERE id = 1;
  END IF;

  INSERT INTO public.encuesta_cm_runs
    (origen, modo, ventana_desde, ventana_hasta, overall, cursos, respuestas, publicables, destinatarios, resumen, error)
  VALUES
    (p_origen, 'real', p_desde, p_corte, v_overall, v_cursos, v_resp, v_pub,
     NULLIF(array_to_string(v_destinatarios, '; '), ''), p_resumen, p_error);

  RETURN jsonb_build_object('ok', p_error IS NULL, 'overall', v_overall, 'destinatarios', to_jsonb(v_destinatarios));
END; $$;
REVOKE ALL ON FUNCTION public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb, text) TO service_role;
