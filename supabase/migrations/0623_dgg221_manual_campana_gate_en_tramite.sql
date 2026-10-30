-- 0623_dgg221_manual_campana_gate_en_tramite.sql
-- DGG-221 · §6 fan-out: el gate en_tramite faltaba en el camino MANUAL de campañas.
-- --------------------------------------------------------------------------
-- El gate de mig 0621 vivía sólo en el motor automático (prospectos_campana_tick).
-- El launcher manual de gerencia (prospectos_enviar_campana / _preview_campana) NO
-- lo tenía: un gerente podía mandar a mano `captacion-vencida` al segmento `vencida`
-- e incluir a un en_tramite (Bernardo) → el mail de regularizar que Pablo quiere
-- frenar. Se agrega el MISMO criterio: excluir en_tramite SÓLO de las plantillas de
-- vencimiento (captacion-vencida/curso-3190/curso-reno); las bondades (captacion-
-- campus/agenda/tramites/capacitaciones) SÍ alcanzan a los en_tramite (marketing).
-- Firmas idénticas (R16 ok). Resto byte-por-byte igual a la versión previa.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prospectos_enviar_campana(p_template_slug text, p_segmento text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
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
      -- DGG-221: en_tramite no recibe plantillas de vencimiento (sí bondades).
      AND NOT (p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida') AND p.en_tramite)
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
    v_pila := public.prospecto_nombre_pila(v_p.nombre);
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
END $function$;

CREATE OR REPLACE FUNCTION public.prospectos_preview_campana(p_template_slug text, p_segmento text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_tpl_ok boolean; v_es_venc boolean; v_bloqueado boolean;
  v_en_seg int; v_sin_email int; v_suprimidos int; v_en_gracia int; v_en_cooldown int; v_elegibles int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.email_templates WHERE slug = p_template_slug AND activo) INTO v_tpl_ok;
  v_es_venc := p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida');
  v_bloqueado := v_es_venc AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90');

  WITH pool AS (
    SELECT p.id, p.email,
           (p.email LIKE '%@padron.invalid') AS no_email,
           public.email_esta_suprimido(p.email) AS supr,
           (EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                     AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
            OR EXISTS(SELECT 1 FROM public.email_queue q WHERE q.related_table = 'prospectos'
                     AND q.related_id = p.id AND q.enviado_at IS NULL
                     AND q.created_at >= (v_hoy - v_gracia)::timestamptz)) AS en_gracia,
           EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                    AND pm.template_slug = p_template_slug
                    AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) AS en_cd
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
      -- DGG-221: en_tramite no entra al pool de plantillas de vencimiento (sí bondades).
      AND NOT (v_es_venc AND p.en_tramite)
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
END $function$;
