-- 0637_dgg240_encuestas_export_cm.sql
-- DGG-240 · Export de encuestas de satisfacción (PDF + Excel) + digest
-- periódico al Community Manager.
--
-- Qué hace esta migración (sólo DB; la generación de archivos vive en la edge
-- `encuesta-export`, probada en Deno con pdf-lib + xlsx):
--   1. Columnas de config en config_global (fila singleton id=1) para el job
--      gated por flag — misma convención que agente_cierre_* y prospectos_*.
--   2. Amplía el bucket `email-assets` para aceptar .xlsx además de .pdf
--      (así el digest puede hospedar ambos adjuntos sin tocar dispatch-emails
--      → sin gate R7). El bucket ya está en ATTACH_BUCKETS.
--   3. Tabla de auditoría encuesta_cm_runs (molde agente_cierre_runs · R6).
--   4. RPC encuesta_export_dataset  — dataset crudo (meta+preguntas+filas) del
--      universo completo de la ventana (R19). La agregación la hace la edge en
--      JS, replicando StatCard (una sola fuente de lógica).
--   5. RPC encuesta_cm_estado      — config + preview + due (para la pantalla
--      de gerencia y la edge).
--   6. RPC encuesta_cm_commit      — atómico (R5): encola 1 mail por
--      destinatario (split ';' / ',') con los 2 adjuntos por storage-ref,
--      avanza el reloj (cubierto_hasta/ultimo_envio_at) y loguea la corrida.
--   7. Plantilla de email `encuesta-cm-digest` (manaxer-v1, casilla cursos@).
--   8. Cron diario 10:00 ART que despierta la edge sólo si el flag está activo
--      (la edge chequea el due de 30 días). Nace inofensivo: activo=false.
--
-- Reglas: R2 (RLS), R5 (multi-tabla en RPC SECDEF), R6 (GRANT explícito),
-- R16 (DROP antes de CREATE · sin overloads), R17 (SECDEF al escribir en
-- tablas RLS sin policy de write), R19 (KPIs sobre universo completo).

-- ============================================================================
-- 1. Config en config_global (singleton id=1)
-- ============================================================================
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS encuesta_cm_activo        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS encuesta_cm_emails        text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS encuesta_cm_cada_dias      integer     NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS encuesta_cm_cubierto_hasta timestamptz,            -- NULL = desde el principio de los tiempos
  ADD COLUMN IF NOT EXISTS encuesta_cm_ultimo_envio_at timestamptz;

COMMENT ON COLUMN public.config_global.encuesta_cm_activo IS
  'DGG-240 · gate del digest periódico de encuestas al CM. OFF por defecto.';
COMMENT ON COLUMN public.config_global.encuesta_cm_emails IS
  'DGG-240 · destinatarios del digest (varios separados por ; o ,).';
COMMENT ON COLUMN public.config_global.encuesta_cm_cada_dias IS
  'DGG-240 · cadencia en días del digest (default 30).';
COMMENT ON COLUMN public.config_global.encuesta_cm_cubierto_hasta IS
  'DGG-240 · upper-bound exclusivo ya cubierto. NULL = nada cubierto aún (primer disparo toma desde -infinito).';
COMMENT ON COLUMN public.config_global.encuesta_cm_ultimo_envio_at IS
  'DGG-240 · timestamp del último disparo (define el reloj de 30 días).';

-- ============================================================================
-- 2. Ampliar bucket email-assets para aceptar .xlsx (hoy sólo pdf)
-- ============================================================================
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
 WHERE id = 'email-assets';

-- ============================================================================
-- 3. Tabla de auditoría de corridas (molde agente_cierre_runs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.encuesta_cm_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at         timestamptz NOT NULL DEFAULT now(),
  origen         text        NOT NULL,             -- 'cron' | 'manual'
  modo           text        NOT NULL DEFAULT 'real',
  ventana_desde  timestamptz,                      -- NULL = -infinito
  ventana_hasta  timestamptz NOT NULL,
  overall        text        NOT NULL,             -- 'ok' | 'sin_novedad' | 'sin_destinatarios' | 'error'
  cursos         integer     NOT NULL DEFAULT 0,
  respuestas     integer     NOT NULL DEFAULT 0,
  publicables    integer     NOT NULL DEFAULT 0,
  destinatarios  text,
  resumen        jsonb,
  error          text,
  created_by     uuid
);

ALTER TABLE public.encuesta_cm_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encuesta_cm_runs FROM anon, authenticated;
-- R6: GRANT explícito. Lectura staff; la escritura va sólo por la RPC SECDEF.
GRANT SELECT ON public.encuesta_cm_runs TO authenticated;

DROP POLICY IF EXISTS encuesta_cm_runs_staff_select ON public.encuesta_cm_runs;
CREATE POLICY encuesta_cm_runs_staff_select ON public.encuesta_cm_runs
  FOR SELECT TO authenticated
  USING (private.is_gerente());

CREATE INDEX IF NOT EXISTS idx_encuesta_cm_runs_run_at ON public.encuesta_cm_runs (run_at DESC);

-- ============================================================================
-- 4. RPC dataset (universo completo de la ventana · R19)
--    R16: DROP antes de CREATE para no dejar overloads.
-- ============================================================================
DROP FUNCTION IF EXISTS public.encuesta_export_dataset(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.encuesta_export_dataset(
  p_desde       timestamptz,
  p_hasta       timestamptz,
  p_encuesta_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (private.is_gerente() OR auth.role() = 'service_role') THEN
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
               AND r.created_at <  p_hasta
           ))
  ),
  resp AS (
    SELECT
      r.encuesta_id,
      r.created_at,
      r.permite_publicar,
      jsonb_build_object(
        'id',                  r.id,
        'fecha',               r.created_at,
        'alumno_nombre',       pr.full_name,
        'respuestas',          r.respuestas,
        'permite_publicar',    r.permite_publicar,
        'publicado',           r.publicado,
        'testimonio_nombre',   r.testimonio_nombre,
        'testimonio_comentario', r.testimonio_comentario,
        'testimonio_foto_url', r.testimonio_foto_url
      ) AS row_json
    FROM public.curso_encuesta_respuestas r
    JOIN encuestas_sel es ON es.id = r.encuesta_id
    LEFT JOIN public.curso_matriculas m ON m.id = r.matricula_id
    LEFT JOIN public.profiles pr        ON pr.id = m.profile_id
    WHERE r.created_at >= COALESCE(p_desde, '-infinity'::timestamptz)
      AND r.created_at <  p_hasta
  ),
  por_curso AS (
    SELECT
      es.id, es.titulo, es.curso_titulo, es.schema,
      count(rr.row_json)                                              AS total,
      count(rr.row_json) FILTER (WHERE rr.permite_publicar)            AS publicables,
      COALESCE(
        jsonb_agg(rr.row_json ORDER BY rr.created_at DESC)
          FILTER (WHERE rr.row_json IS NOT NULL),
        '[]'::jsonb
      )                                                               AS respuestas
    FROM encuestas_sel es
    LEFT JOIN resp rr ON rr.encuesta_id = es.id
    GROUP BY es.id, es.titulo, es.curso_titulo, es.schema
  )
  SELECT jsonb_build_object(
    'generado_at', now(),
    'desde',       p_desde,
    'hasta',       p_hasta,
    'cursos', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'encuesta_id',  pc.id,
          'titulo',       pc.titulo,
          'curso_titulo', pc.curso_titulo,
          'preguntas',    COALESCE(pc.schema->'preguntas', '[]'::jsonb),
          'total',        pc.total,
          'publicables',  pc.publicables,
          'respuestas',   pc.respuestas
        ) ORDER BY pc.total DESC
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM por_curso pc;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.encuesta_export_dataset(timestamptz, timestamptz, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_export_dataset(timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ============================================================================
-- 5. RPC estado (config + preview + due)
-- ============================================================================
DROP FUNCTION IF EXISTS public.encuesta_cm_estado();
CREATE FUNCTION public.encuesta_cm_estado() RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activo    boolean;
  v_emails    text;
  v_cada      integer;
  v_cubierto  timestamptz;
  v_ultimo    timestamptz;
  v_corte     timestamptz;
  v_cursos    integer;
  v_resp      integer;
  v_pub       integer;
BEGIN
  IF NOT (private.is_gerente() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT encuesta_cm_activo, encuesta_cm_emails, encuesta_cm_cada_dias,
         encuesta_cm_cubierto_hasta, encuesta_cm_ultimo_envio_at
    INTO v_activo, v_emails, v_cada, v_cubierto, v_ultimo
  FROM public.config_global WHERE id = 1;

  -- corte = inicio de HOY en hora Argentina (upper-bound exclusivo → cubre hasta ayer)
  v_corte := (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
               AT TIME ZONE 'America/Argentina/Buenos_Aires';

  SELECT count(DISTINCT r.encuesta_id),
         count(*),
         count(*) FILTER (WHERE r.permite_publicar)
    INTO v_cursos, v_resp, v_pub
  FROM public.curso_encuesta_respuestas r
  WHERE r.created_at >= COALESCE(v_cubierto, '-infinity'::timestamptz)
    AND r.created_at <  v_corte;

  RETURN jsonb_build_object(
    'activo',          v_activo,
    'emails',          v_emails,
    'cada_dias',       v_cada,
    'cubierto_hasta',  v_cubierto,
    'ultimo_envio_at', v_ultimo,
    'proximo_envio_at', CASE WHEN v_ultimo IS NOT NULL
                             THEN v_ultimo + make_interval(days => v_cada) END,
    'due', v_activo AND (v_ultimo IS NULL OR now() >= v_ultimo + make_interval(days => v_cada)),
    'corte', v_corte,
    'preview', jsonb_build_object('cursos', v_cursos, 'respuestas', v_resp, 'publicables', v_pub)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.encuesta_cm_estado() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cm_estado() TO authenticated, service_role;

-- ============================================================================
-- 6. RPC commit (atómico · sólo service_role / la edge)
--    R5 (multi-tabla) + R17 (SECDEF escribe en email_queue + encuesta_cm_runs).
-- ============================================================================
DROP FUNCTION IF EXISTS public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb);
CREATE FUNCTION public.encuesta_cm_commit(
  p_origen        text,
  p_corte         timestamptz,
  p_desde         timestamptz,
  p_bucket        text,
  p_pdf_path      text,          -- NULL = sin novedad (no se encola mail)
  p_xlsx_path     text,
  p_pdf_filename  text,
  p_xlsx_filename text,
  p_resumen       jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emails       text;
  v_lista        text[];
  v_email        text;
  v_destinatarios text[] := '{}';
  v_overall      text;
  v_cursos       integer := COALESCE((p_resumen->>'cursos')::integer, 0);
  v_resp         integer := COALESCE((p_resumen->>'respuestas')::integer, 0);
  v_pub          integer := COALESCE((p_resumen->>'publicables')::integer, 0);
  v_vars         jsonb;
  v_att          jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT encuesta_cm_emails INTO v_emails FROM public.config_global WHERE id = 1;

  IF p_pdf_path IS NOT NULL THEN
    v_overall := 'ok';
    v_lista := regexp_split_to_array(COALESCE(v_emails, ''), '[;,\s]+');
    v_vars := jsonb_build_object(
      'periodo',     COALESCE(p_resumen->>'periodo_label', ''),
      'cursos',      v_cursos::text,
      'respuestas',  v_resp::text,
      'publicables', v_pub::text
    );
    v_att := jsonb_build_array(
      jsonb_build_object('filename', p_pdf_filename,  'storage_bucket', p_bucket,
                         'storage_path', p_pdf_path,  'content_type', 'application/pdf'),
      jsonb_build_object('filename', p_xlsx_filename, 'storage_bucket', p_bucket,
                         'storage_path', p_xlsx_path, 'content_type',
                         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    );
    FOREACH v_email IN ARRAY v_lista LOOP
      IF v_email IS NULL OR btrim(v_email) = '' THEN CONTINUE; END IF;
      INSERT INTO public.email_queue
        (kind, template_slug, to_email, to_nombre, variables, attachments_jsonb,
         prioridad, related_table, programado_para)
      VALUES
        ('workflow', 'encuesta-cm-digest', lower(btrim(v_email)), 'Community Manager',
         v_vars, v_att, 5, 'curso_encuestas', now());
      v_destinatarios := array_append(v_destinatarios, lower(btrim(v_email)));
    END LOOP;
    IF array_length(v_destinatarios, 1) IS NULL THEN
      v_overall := 'sin_destinatarios';
    END IF;
  ELSE
    v_overall := 'sin_novedad';
  END IF;

  -- Avanza el reloj SIEMPRE que sea una corrida real.
  UPDATE public.config_global
     SET encuesta_cm_cubierto_hasta  = p_corte,
         encuesta_cm_ultimo_envio_at = now()
   WHERE id = 1;

  INSERT INTO public.encuesta_cm_runs
    (origen, modo, ventana_desde, ventana_hasta, overall, cursos, respuestas,
     publicables, destinatarios, resumen)
  VALUES
    (p_origen, 'real', p_desde, p_corte, v_overall, v_cursos, v_resp, v_pub,
     NULLIF(array_to_string(v_destinatarios, '; '), ''), p_resumen);

  RETURN jsonb_build_object('ok', true, 'overall', v_overall, 'destinatarios', to_jsonb(v_destinatarios));
END;
$$;

REVOKE ALL ON FUNCTION public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_cm_commit(text, timestamptz, timestamptz, text, text, text, text, text, jsonb) TO service_role;

-- ============================================================================
-- 7. Plantilla de email del digest (manaxer-v1 · casilla cursos@)
-- ============================================================================
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, activo, kicker, titulo_visual,
   color_acento, mostrar_logo, cuerpo_html_visual, firma, incluir_tabla_envio, layout_version)
VALUES (
  'encuesta-cm-digest',
  'Encuestas · digest al Community Manager',
  'Encuestas de satisfacción · resumen {{periodo}}',
  '',  -- body_html vacío a propósito: forzamos el render manaxer (cuerpo_html_visual)
  'cursos',
  true,
  'ENCUESTAS DE SATISFACCIÓN',
  'Resumen para contenidos',
  '#009ECA',
  true,
  '<p style="margin:0 0 14px">Hola, equipo 👋</p>'
  '<p style="margin:0 0 14px">Adjuntamos el resumen de las encuestas de satisfacción '
  'del período <strong>{{periodo}}</strong>, listo para trabajar material.</p>'
  '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px">'
  '<tr>'
  '<td style="padding:10px 6px;border:1px solid #e2e8f0;border-radius:8px;text-align:center">'
  '<div style="font-size:22px;font-weight:700;color:#009ECA">{{cursos}}</div>'
  '<div style="font-size:12px;color:#5D7284">curso(s) con novedad</div></td>'
  '<td style="padding:10px 6px;border:1px solid #e2e8f0;text-align:center">'
  '<div style="font-size:22px;font-weight:700;color:#122230">{{respuestas}}</div>'
  '<div style="font-size:12px;color:#5D7284">respuesta(s) nuevas</div></td>'
  '<td style="padding:10px 6px;border:1px solid #e2e8f0;text-align:center">'
  '<div style="font-size:22px;font-weight:700;color:#0E9F6E">{{publicables}}</div>'
  '<div style="font-size:12px;color:#5D7284">publicable(s)</div></td>'
  '</tr></table>'
  '<p style="margin:0 0 6px"><strong>Adjuntos:</strong></p>'
  '<ul style="margin:0 0 14px;padding-left:18px;color:#122230">'
  '<li><strong>PDF</strong> — resumen con gráficos, estrellas y testimonios (los publicables, identificados).</li>'
  '<li><strong>Excel</strong> — una fila por respuesta, con el enlace a la foto cuando el alumno la subió.</li>'
  '</ul>'
  '<p style="margin:0;font-size:13px;color:#5D7284">Los casos marcados como <strong>PUBLICABLE</strong> son los que el alumno autorizó a difundir (nombre + comentario + foto). El resto cuenta en los totales, sin nombrarlos.</p>',
  'Gestión Global · Campus',
  false,
  'manaxer-v1'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual,
  color_acento = EXCLUDED.color_acento,
  from_casilla = EXCLUDED.from_casilla,
  firma = EXCLUDED.firma,
  activo = true,
  updated_at = now();

-- ============================================================================
-- 8. Cron diario 10:00 ART (13:00 UTC). Nace inofensivo (activo=false):
--    sólo despierta la edge si el flag está activo; el due de 30 días lo
--    verifica la edge.
-- ============================================================================
SELECT cron.unschedule('encuesta-cm-digest-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encuesta-cm-digest-diario');

SELECT cron.schedule('encuesta-cm-digest-diario', '0 13 * * *', $cron$
  DO $do$
  BEGIN
    IF (SELECT encuesta_cm_activo FROM public.config_global WHERE id = 1) THEN
      PERFORM net.http_post(
        url     := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/encuesta-export',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', private.cron_bearer()),
        body    := jsonb_build_object('mode', 'digest'),
        timeout_milliseconds := 55000
      );
    END IF;
  END
  $do$;
$cron$);
