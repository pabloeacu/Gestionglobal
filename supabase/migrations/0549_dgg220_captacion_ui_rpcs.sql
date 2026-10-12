-- 0549_dgg220_captacion_ui_rpcs.sql
-- =============================================================================
-- DGG-220 · Fase 5 — RPCs de lectura para la UI de gerencia (CRM de captación):
--   (1) prospectos_captacion_kpis()   — KPIs sobre el UNIVERSO completo (R19).
--   (2) prospectos_captacion_list()   — grilla paginada (feedback_grillas:50+filtros).
--   (3) prospectos_preview_campana()  — cuántos recibirían una campaña (read-only).
-- + GATE server-side: prospectos_enviar_campana() ahora exige el flag activo
--   (defensa en profundidad: ni un gerente puede mandar antes de la revisión).
--
-- Todo STABLE/SECDEF staff-gated. Sin cambios de esquema. R16: firmas únicas /
-- enviar mantiene su firma (CREATE OR REPLACE, sin overload). R19: los KPIs se
-- calculan sobre el universo padron_pba; la lista es paginada aparte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) KPIs del universo de captación (R19: universo, no la página visible).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_captacion_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean;
  v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(prospectos_campanas_activo, false) INTO v_activo FROM public.config_global LIMIT 1;

  SELECT jsonb_build_object(
    'total',             count(*),
    'con_email_real',    count(*) FILTER (WHERE email NOT LIKE '%@padron.invalid'),
    'sin_email',         count(*) FILTER (WHERE email LIKE '%@padron.invalid'),
    'sancionados',       count(*) FILTER (WHERE sanciones),
    'convertidos',       count(*) FILTER (WHERE convertido_at IS NOT NULL),
    'bajas',             count(*) FILTER (WHERE baja_at IS NOT NULL),
    'contactados',       count(*) FILTER (WHERE ultimo_mail_at IS NOT NULL),
    'seg_vencida',       count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'vencida'),
    'seg_curso_reno_30', count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'curso_reno_30'),
    'seg_curso_31_90',   count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'curso_31_90'),
    'seg_vigente_lejos', count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'vigente_lejos'),
    'seg_sin_dato',      count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'sin_dato')
  ) INTO v_res
  FROM public.prospectos WHERE origen = 'padron_pba';

  RETURN COALESCE(v_res, '{}'::jsonb) || jsonb_build_object(
    'activo',            v_activo,
    'hoy',               v_hoy,
    'enriquecidos',      (SELECT count(*) FROM public.prospecto_padron WHERE tramix_at IS NOT NULL),
    'enrich_pendientes', (SELECT count(*) FROM public.prospecto_tramix_queue WHERE estado = 'pendiente'),
    'padron_total',      (SELECT count(*) FROM public.prospecto_padron)
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_captacion_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_captacion_kpis() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (2) Grilla paginada. Orden: vencimiento ASC NULLS LAST (lo accionable primero).
--     total_count = ventana sobre el set filtrado (para el paginador).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_captacion_list(
  p_segmento text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_solo_sancionados boolean DEFAULT false,
  p_solo_con_email boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0)
 RETURNS TABLE(
   id uuid, nombre text, email text, cuit text, matricula text, legajo text,
   matricula_vencimiento date, ultima_renovacion date, segmento text,
   estado_captacion text, sanciones boolean, sin_email boolean, suprimido boolean,
   ultimo_mail_slug text, ultimo_mail_asunto text, ultimo_mail_at timestamptz,
   convertido_at timestamptz, baja_at timestamptz, padron_count bigint, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_off int := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.*,
           public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg,
           (p.email LIKE '%@padron.invalid') AS no_email
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
  ), filtered AS (
    SELECT * FROM base b
    WHERE (p_segmento IS NULL OR b.seg = p_segmento)
      AND (p_estado IS NULL OR b.estado_captacion = p_estado)
      AND (NOT p_solo_sancionados OR b.sanciones)
      AND (NOT p_solo_con_email OR NOT b.no_email)
      AND (v_q IS NULL
           OR b.nombre ILIKE '%'||v_q||'%' OR b.email ILIKE '%'||v_q||'%'
           OR b.cuit ILIKE '%'||v_q||'%'   OR b.legajo ILIKE '%'||v_q||'%'
           OR b.matricula ILIKE '%'||v_q||'%')
  ), counted AS (
    SELECT *, count(*) OVER() AS tc FROM filtered
  )
  SELECT c.id, c.nombre, c.email, c.cuit, c.matricula, c.legajo,
         c.matricula_vencimiento, c.ultima_renovacion, c.seg,
         c.estado_captacion, c.sanciones, c.no_email,
         public.email_esta_suprimido(c.email),
         c.ultimo_mail_slug, c.ultimo_mail_asunto, c.ultimo_mail_at,
         c.convertido_at, c.baja_at,
         (SELECT count(*) FROM public.prospecto_padron pp WHERE pp.prospecto_id = c.id),
         c.tc
  FROM counted c
  ORDER BY c.matricula_vencimiento ASC NULLS LAST, c.nombre ASC
  LIMIT v_lim OFFSET v_off;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, int, int) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (3) Preview de campaña: cuántos recibirían (misma elegibilidad que enviar,
--     SIN encolar). Read-only. Para el launcher de la UI.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_preview_campana(
  p_template_slug text, p_segmento text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_tpl_ok boolean; v_es_venc boolean; v_bloqueado boolean;
  v_en_seg int; v_sin_email int; v_suprimidos int; v_en_gracia int; v_en_cooldown int; v_elegibles int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.email_templates WHERE slug = p_template_slug AND activo) INTO v_tpl_ok;
  v_es_venc := p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida');
  -- mismo guard que enviar: template de vencimiento exige segmento de vencimiento
  v_bloqueado := v_es_venc AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90');

  WITH pool AS (
    SELECT p.id, p.email,
           (p.email LIKE '%@padron.invalid') AS no_email,
           public.email_esta_suprimido(p.email) AS supr,
           EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                    AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz) AS en_gracia,
           EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                    AND pm.template_slug = p_template_slug
                    AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) AS en_cd
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE no_email),
    count(*) FILTER (WHERE NOT no_email AND supr),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND en_gracia),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND en_cd),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND NOT en_cd)
  INTO v_en_seg, v_sin_email, v_suprimidos, v_en_gracia, v_en_cooldown, v_elegibles
  FROM pool;

  RETURN jsonb_build_object(
    'template', p_template_slug, 'template_existe', COALESCE(v_tpl_ok, false),
    'segmento', p_segmento, 'es_de_vencimiento', v_es_venc, 'bloqueado_guard', v_bloqueado,
    'en_segmento', COALESCE(v_en_seg, 0),
    'sin_email', COALESCE(v_sin_email, 0),
    'suprimidos', COALESCE(v_suprimidos, 0),
    'en_gracia', COALESCE(v_en_gracia, 0),
    'en_cooldown', COALESCE(v_en_cooldown, 0),
    'elegibles', CASE WHEN v_bloqueado OR NOT COALESCE(v_tpl_ok, false) THEN 0 ELSE COALESCE(v_elegibles, 0) END
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_preview_campana(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_preview_campana(text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (4) GATE server-side en el envío manual: exige el flag activo. Mismo cuerpo
--     que 0548, con el gate agregado tras is_staff (firma intacta → R16 safe).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_enviar_campana(
  p_template_slug text, p_segmento text DEFAULT NULL, p_limite int DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_lim int := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);  -- §6 B#3: tope warm-up (frío)
  v_asunto text; v_toques int := 0; v_p record; v_vars jsonb; v_dias int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  -- DGG-220 F5 GATE: nada sale hasta que Pablo active el motor (defensa en
  -- profundidad; el mismo flag que el motor AUTO). flag OFF → no-op explícito.
  IF NOT (SELECT COALESCE(prospectos_campanas_activo, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_desactivado', 'gated', true, 'encolados', 0);
  END IF;
  -- §6 C/D2: los templates de VENCIMIENTO usan {{fecha_vencimiento}}/{{dias_restantes}} →
  -- exigen un prospecto con vencimiento; son del motor AUTO. En el manual, sólo con segmento de vencimiento.
  IF p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida')
     AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_de_vencimiento_requiere_segmento');
  END IF;
  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = p_template_slug AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'template_inexistente'); END IF;

  FOR v_p IN
    SELECT id, nombre, email, matricula_vencimiento
    FROM public.prospectos
    WHERE origen = 'padron_pba'
      AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid'
      AND (p_segmento IS NULL OR public.prospecto_segmento(matricula_vencimiento, v_hoy) = p_segmento)
    ORDER BY matricula_vencimiento ASC NULLS LAST
  LOOP
    EXIT WHEN v_toques >= v_lim;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = p_template_slug
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_dias := CASE WHEN v_p.matricula_vencimiento IS NOT NULL THEN GREATEST(0, (v_p.matricula_vencimiento - v_hoy)) END;
    v_vars := jsonb_build_object('nombre', initcap(v_p.nombre));
    IF v_p.matricula_vencimiento IS NOT NULL THEN
      v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento,'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
    END IF;
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', p_template_slug, trim(v_p.email), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'encolados', v_toques, 'template', p_template_slug, 'segmento', p_segmento);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_enviar_campana(text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_enviar_campana(text, text, int) TO authenticated, service_role;
