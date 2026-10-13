-- 0559_dgg221_sexto_fixes.sql
-- =============================================================================
-- DGG-221 · Fixes de la §6 (3 agentes). CRÍTICO: 2 clientes reales estaban en el
-- pool de prospectos porque su legajo coincide con administraciones.legajo_rpac
-- aunque cuit/email difieren → al activar el motor recibirían mail en frío.
--   #4 (crítico): excluir por legajo_rpac en re-import + motor + manual (defensa
--      en profundidad) + convertir los que ya están en el pool.
--   #3b (menor): el envío manual ahora respeta la auto-pausa de reputación.
--   #7b (perf): índice prospecto_mails(prospecto_id, template_slug).
-- =============================================================================

-- (c) convertir los prospectos que en realidad son clientes (match por legajo_rpac).
UPDATE public.prospectos p
   SET convertido_a_administracion_id = a.id,
       convertido_at = COALESCE(p.convertido_at, now()),
       estado_captacion = 'convertido',
       updated_at = now()
  FROM public.administraciones a
 WHERE a.legajo_rpac = p.legajo
   AND p.origen = 'padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL;

-- (#7b) índice de no-repetición por template (futuro-escala).
CREATE INDEX IF NOT EXISTS idx_prospecto_mails_tpl ON public.prospecto_mails(prospecto_id, template_slug);

-- (#4a) re-import: excluir clientes también por legajo = legajo_rpac.
CREATE OR REPLACE FUNCTION public.prospectos_reimport_aplicar(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_total int; v_clientes int; v_nuevos_prosp int; v_nuevos_padron int; v_encolados int;
BEGIN
  CREATE TEMP TABLE _stage ON COMMIT DROP AS
  SELECT
    NULLIF(btrim(r->>'matricula'),'') AS matricula,
    NULLIF(regexp_replace(COALESCE(r->>'legajo',''),'\D','','g'),'') AS legajo,
    initcap(btrim(regexp_replace(COALESCE(r->>'nombre',''),'\s+',' ','g'))) AS nombre,
    NULLIF(regexp_replace(COALESCE(r->>'cuit',''),'\D','','g'),'') AS cuit,
    CASE WHEN lower(btrim(COALESCE(r->>'mail',''))) IN ('','no figura','nofigura','s/d','-')
         THEN NULL ELSE lower(btrim(r->>'mail')) END AS email,
    (upper(btrim(COALESCE(r->>'sanciones',''))) IN ('SI','SÍ','S')) AS sanciones
  FROM jsonb_array_elements(p_rows) r;

  DELETE FROM _stage WHERE legajo IS NULL OR nombre = '';
  SELECT count(*) INTO v_total FROM _stage;

  DELETE FROM _stage s WHERE
    (s.cuit IS NOT NULL AND EXISTS (SELECT 1 FROM public.administraciones a WHERE regexp_replace(COALESCE(a.cuit,''),'\D','','g') = s.cuit))
    OR (s.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administraciones a WHERE lower(btrim(COALESCE(a.email,''))) = s.email))
    OR EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = s.legajo);
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  DELETE FROM _stage s WHERE EXISTS (SELECT 1 FROM public.prospecto_padron pp WHERE pp.legajo = s.legajo);

  UPDATE _stage SET email = legajo || '@padron.invalid' WHERE email IS NULL;

  INSERT INTO public.prospectos (nombre, email, cuit, matricula, legajo, sanciones, origen)
  SELECT DISTINCT ON (s.email) s.nombre, s.email, s.cuit, s.matricula, s.legajo, s.sanciones, 'padron_pba'
  FROM _stage s
  WHERE NOT EXISTS (SELECT 1 FROM public.prospectos p WHERE p.email = s.email)
  ORDER BY s.email, s.legajo
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS v_nuevos_prosp = ROW_COUNT;

  WITH ins AS (
    INSERT INTO public.prospecto_padron (prospecto_id, matricula, legajo, cuit, nombre, sanciones)
    SELECT p.id, s.matricula, s.legajo, s.cuit, s.nombre, s.sanciones
    FROM _stage s JOIN public.prospectos p ON p.email = s.email
    ON CONFLICT (prospecto_id, legajo) WHERE legajo IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_nuevos_padron FROM ins;

  WITH enc AS (
    INSERT INTO public.prospecto_tramix_queue (padron_id, legajo)
    SELECT pp.id, pp.legajo
    FROM public.prospecto_padron pp
    JOIN _stage s ON s.legajo = pp.legajo
    WHERE pp.tramix_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.prospecto_tramix_queue q WHERE q.padron_id = pp.id)
    RETURNING 1
  ) SELECT count(*) INTO v_encolados FROM enc;

  RETURN jsonb_build_object(
    'filas_usables', v_total, 'clientes_excluidos', v_clientes,
    'nuevos_prospectos', v_nuevos_prosp, 'nuevos_padron', v_nuevos_padron, 'encolados_tramix', v_encolados);
END $fn$;

-- (#4b) motor tick: red de seguridad — excluir prospectos con legajo = legajo_rpac de un cliente.
CREATE OR REPLACE FUNCTION public.prospectos_campana_tick()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_cap int;
  v_gracia int := 30;
  v_hoy_count int;
  v_rep_total int; v_rep_bad int; v_rep_rate numeric;
  v_target text; v_p record; v_asunto text; v_vars jsonb; v_dias int; v_pila text;
  v_bondades text[] := ARRAY['captacion-campus','captacion-agenda','captacion-tramites','captacion-capacitaciones'];
BEGIN
  SELECT prospectos_campanas_activo, prospectos_pausado_reputacion, prospectos_cap_diario
    INTO v_activo, v_pausado, v_cap FROM public.config_global LIMIT 1;

  IF NOT COALESCE(v_activo, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'gated', 'activo', false); END IF;
  IF COALESCE(v_pausado, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'pausado_reputacion'); END IF;

  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_rep_total, v_rep_bad
    FROM public.sent_emails
   WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  IF v_rep_total >= 20 THEN
    v_rep_rate := v_rep_bad::numeric / v_rep_total;
    IF v_rep_rate > 0.05 THEN
      UPDATE public.config_global
         SET prospectos_pausado_reputacion = true,
             prospectos_pausado_motivo = format('Auto-pausa %s: rebotes/quejas %s/%s (%s%%) en 7d supera el 5%%.',
               v_hoy, v_rep_bad, v_rep_total, round(v_rep_rate*100,1));
      PERFORM public.notify_all_gerentes('prospectos_motor_pausado', 'Motor de captación auto-pausado (reputación)',
        format('Rebotes/quejas: %s de %s envíos (%s%%) en 7 días. El motor se detuvo solo para proteger la entregabilidad. Revisá y reactivá cuando quieras.',
          v_rep_bad, v_rep_total, round(v_rep_rate*100,1)),
        '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, false);
      RETURN jsonb_build_object('ok', true, 'accion', 'freno_reputacion', 'rate', round(v_rep_rate*100,1));
    END IF;
  END IF;

  SELECT count(*) INTO v_hoy_count FROM public.email_queue
   WHERE related_table = 'prospectos' AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap); END IF;

  v_target := (ARRAY['urgente','vencida','bondad'])[(v_hoy_count % 3) + 1];

  SELECT * INTO v_p FROM (
    WITH elig AS (
      SELECT p.id, p.nombre, p.email, p.matricula_vencimiento,
             public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg
      FROM public.prospectos p
      WHERE p.origen='padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
        AND p.email NOT LIKE '%@padron.invalid'
        AND NOT public.email_esta_suprimido(p.email)
        AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
        AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
        AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM public.email_queue q WHERE q.related_table='prospectos' AND q.related_id=p.id AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz)
    ), nx AS (
      SELECT e.*,
        CASE e.seg WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                   WHEN 'curso_31_90' THEN 'captacion-curso-3190'
                   WHEN 'vencida' THEN 'captacion-vencida' END AS venc_tpl,
        (SELECT count(*) FROM public.prospecto_mails pm WHERE pm.prospecto_id=e.id) AS n_mails
      FROM elig e
    ), nx2 AS (
      SELECT n.*,
        (n.venc_tpl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=n.venc_tpl)) AS venc_pending,
        (SELECT b FROM unnest(v_bondades) b WHERE NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=b) LIMIT 1) AS next_bondad
      FROM nx n
    ), fin AS (
      SELECT id, nombre, email, matricula_vencimiento, seg, n_mails,
        CASE WHEN venc_pending THEN venc_tpl ELSE next_bondad END AS tpl,
        CASE WHEN venc_pending THEN (CASE WHEN seg='vencida' THEN 'vencida' ELSE 'urgente' END) ELSE 'bondad' END AS bucket
      FROM nx2 WHERE venc_pending OR next_bondad IS NOT NULL
    )
    SELECT * FROM fin
    WHERE EXISTS (SELECT 1 FROM public.email_templates et WHERE et.slug = fin.tpl AND et.activo)
    ORDER BY (bucket = v_target) DESC,
             CASE bucket WHEN 'urgente' THEN 1 WHEN 'vencida' THEN 2 ELSE 3 END,
             CASE WHEN bucket='urgente' THEN matricula_vencimiento END ASC NULLS LAST,
             CASE WHEN bucket='vencida' THEN matricula_vencimiento END DESC NULLS LAST,
             CASE WHEN bucket='bondad' THEN n_mails END ASC NULLS LAST, id
    LIMIT 1
  ) s;

  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'accion', 'sin_candidatos', 'target', v_target); END IF;

  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_p.tpl AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_p.tpl); END IF;

  v_pila := initcap(split_part(btrim(regexp_replace(v_p.nombre, '\s+', ' ', 'g')), ' ', 1));
  v_vars := jsonb_build_object('nombre', v_pila);
  IF v_p.matricula_vencimiento IS NOT NULL THEN
    v_dias := GREATEST(0, (v_p.matricula_vencimiento - v_hoy));
    v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento, 'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
  END IF;

  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_p.tpl, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_p.tpl,
    'bucket', v_p.bucket, 'target', v_target, 'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $fn$;

-- (#3b + #4b) manual: respeta la auto-pausa + excluye clientes por legajo_rpac.
CREATE OR REPLACE FUNCTION public.prospectos_enviar_campana(
  p_template_slug text, p_segmento text DEFAULT NULL, p_limite int DEFAULT 50, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_lim int := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_asunto text; v_toques int := 0; v_p record; v_vars jsonb; v_dias int; v_pila text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT (SELECT COALESCE(prospectos_campanas_activo, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_desactivado', 'gated', true, 'encolados', 0);
  END IF;
  IF (SELECT COALESCE(prospectos_pausado_reputacion, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_pausado', 'pausado', true, 'encolados', 0);
  END IF;
  IF p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida')
     AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_de_vencimiento_requiere_segmento');
  END IF;
  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = p_template_slug AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'template_inexistente'); END IF;

  FOR v_p IN
    SELECT p.id, p.nombre, p.email, p.matricula_vencimiento
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
      AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND p.email NOT LIKE '%@padron.invalid'
      AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
      AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
    ORDER BY p.matricula_vencimiento ASC NULLS LAST
  LOOP
    EXIT WHEN v_toques >= v_lim;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    CONTINUE WHEN NOT p_forzar AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = p_template_slug
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_dias := CASE WHEN v_p.matricula_vencimiento IS NOT NULL THEN GREATEST(0, (v_p.matricula_vencimiento - v_hoy)) END;
    v_pila := initcap(split_part(btrim(regexp_replace(v_p.nombre, '\s+', ' ', 'g')), ' ', 1));
    v_vars := jsonb_build_object('nombre', v_pila);
    IF v_p.matricula_vencimiento IS NOT NULL THEN
      v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento,'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
    END IF;
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'encolados', v_toques, 'template', p_template_slug, 'segmento', p_segmento, 'forzado', p_forzar);
END $fn$;
