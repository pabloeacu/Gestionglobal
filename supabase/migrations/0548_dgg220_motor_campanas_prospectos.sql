-- 0548_dgg220_motor_campanas_prospectos.sql
-- =============================================================================
-- DGG-220 · Fase 4 — Motor de campañas a prospectos (auto por vencimiento) + envío
-- manual por segmento (bondades). TODO detrás de un gate: flag OFF + cron NO agendado.
--
-- GATE DGG-199 (triple): (1) `config_global.prospectos_campanas_activo=false` por
-- default → el motor auto es no-op; (2) el cron NO se agenda en esta migración
-- (se agenda a mano tras la revisión de Pablo); (3) cada envío pasa igual por el
-- gate de supresión fail-closed de dispatch-emails (Fase 2). NADA sale hasta revisar.
--
-- Elegibilidad (fuente canónica = timestamps, §6 F3): convertido_at IS NULL AND
-- baja_at IS NULL AND email real (no @padron.invalid) AND no suprimido AND con
-- gracia (1 mail/prospecto/30d) AND cooldown por template (90d). Cap warm-up 25/día.
-- =============================================================================

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS prospectos_campanas_activo boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- Motor AUTO por vencimiento (vencida / curso_reno_30 / curso_31_90). Gated.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_campanas_diario()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean;
  v_cap int := 25;              -- warm-up conservador para reputación (frío)
  v_gracia int := 30;          -- 1 mail de captación por prospecto cada 30 días
  v_cooldown int := 90;        -- no repetir el MISMO email en 90 días
  v_toques int := 0;
  v_p record; v_seg text; v_tpl text; v_asunto text; v_vars jsonb; v_dias int;
  v_cnt_venc int := 0; v_cnt_reno int := 0; v_cnt_3190 int := 0;
BEGIN
  SELECT prospectos_campanas_activo INTO v_activo FROM public.config_global LIMIT 1;
  IF NOT COALESCE(v_activo, false) THEN
    RETURN jsonb_build_object('gated', true, 'activo', false, 'fecha', v_hoy);
  END IF;

  FOR v_p IN
    SELECT id, nombre, email, matricula_vencimiento
    FROM public.prospectos
    WHERE origen = 'padron_pba'
      AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid'
      AND matricula_vencimiento IS NOT NULL
      AND public.prospecto_segmento(matricula_vencimiento, v_hoy) IN ('vencida','curso_reno_30','curso_31_90')
    -- Prioridad: primero los time-critical (ventana que se cierra), después el
    -- backlog de vencidas. Tunable. (Pablo: ajustable si prefiere empujar vencidas.)
    ORDER BY CASE public.prospecto_segmento(matricula_vencimiento, v_hoy)
               WHEN 'curso_reno_30' THEN 1 WHEN 'curso_31_90' THEN 2 ELSE 3 END,
             matricula_vencimiento ASC
  LOOP
    EXIT WHEN v_toques >= v_cap;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    -- gracia: ni enviado ni encolado en los últimos 30 días
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    v_seg := public.prospecto_segmento(v_p.matricula_vencimiento, v_hoy);
    v_tpl := CASE v_seg WHEN 'vencida' THEN 'captacion-vencida'
                        WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                        WHEN 'curso_31_90' THEN 'captacion-curso-3190' END;
    -- cooldown por template (no repetir el mismo mail en 90 días)
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = v_tpl
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_tpl AND activo;
    CONTINUE WHEN v_asunto IS NULL;
    v_dias := GREATEST(0, (v_p.matricula_vencimiento - v_hoy));
    v_vars := jsonb_build_object(
      'nombre', initcap(v_p.nombre),
      'fecha_vencimiento', to_char(v_p.matricula_vencimiento, 'DD/MM/YYYY'),
      'dias_restantes', v_dias::text);
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', v_tpl, trim(v_p.email), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
    IF v_seg = 'vencida' THEN v_cnt_venc := v_cnt_venc + 1;
    ELSIF v_seg = 'curso_reno_30' THEN v_cnt_reno := v_cnt_reno + 1;
    ELSE v_cnt_3190 := v_cnt_3190 + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('fecha', v_hoy, 'toques', v_toques, 'cap', v_cap,
    'vencida', v_cnt_venc, 'curso_reno', v_cnt_reno, 'curso_3190', v_cnt_3190);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_campanas_diario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospectos_campanas_diario() TO service_role;

-- -----------------------------------------------------------------------------
-- Envío MANUAL de una campaña a un segmento (gerencia, para las de bondades).
-- Respeta la misma elegibilidad + gracia + cooldown + supresión. Encola hasta p_limite.
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
