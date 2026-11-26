-- 0735 · DGG-270 — Motor de goteo de la campaña Consultoría Jurídica federal (pedido de Pablo).
-- Pablo: "una vez que terminemos [el curso RPA CABA], vas a comenzar a encolar la campaña de
-- consultoría jurídica a un ritmo de 100 mails diarios. Es decir, a un ritmo similar al de
-- captación PBA con su propia campaña."
--
-- Por qué un TICK y no la RPC one-shot `prospectos_federal_enviar_campana`: la RPC encola todo el
-- segmento de una (escalonado por días), pero Pablo quiere un GOTEO continuo tipo PBA, que cubra el
-- universo nacional de a poco y vaya tomando a los de CABA recién cuando pase su gracia de 30 días
-- (se acaban de llevar el RPA). Esto espeja `prospectos_campana_tick` pero para `federal-consultoria`.
--
-- SECUENCIA (sin automatización frágil): el tick NO encola consultoría hasta que la campaña RPA
-- CABA haya salido Y drenado por completo. Gate durable: existe ≥1 `prospecto_mails` de
-- `federal-rpa-caba` (RPA ya disparó) Y 0 filas `federal-rpa-caba` pendientes en `email_queue`
-- (RPA terminó de drenar). Combinado con la prioridad (consultoría=10, debajo de RPA=9) el orden
-- queda blindado por dos vías.
--
-- MODERACIÓN: cap 100/día propio (`federal_consultoria_cap_diario`, nuevo, default 100), 1 por tick
-- (cron */10, igual que PBA), gracia 30d global + cooldown 90d por plantilla + supresión global +
-- gate del flag federal + respeta la pausa reputacional del carril SES (no encola durante pausa).
-- El dispatcher le pone UTM (source=federal, campaign=federal-consultoria), pie de baja por origen
-- (import_nacional → "jornada/congreso", no DPPJ) y lo rutea por SES (federal-* es SES-only).

-- ───────────── Config: cap diario del goteo de consultoría (tuneable) ─────────────
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS federal_consultoria_cap_diario int NOT NULL DEFAULT 100;
COMMENT ON COLUMN public.config_global.federal_consultoria_cap_diario IS
  'DGG-270: tope diario del goteo de la campaña Consultoría Jurídica federal (motor federal_consultoria_tick). Default 100, como la captación PBA.';

-- ───────────── Motor de goteo ─────────────
CREATE OR REPLACE FUNCTION public.federal_consultoria_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_slug constant text := 'federal-consultoria';
  v_rpa  constant text := 'federal-rpa-caba';
  v_gracia int := 30; v_cooldown int := 90;
  v_activo boolean; v_ses_pausado boolean; v_cap int;
  v_hoy_count int; v_asunto text; v_p record; v_pila text;
BEGIN
  SELECT federal_campanas_activo, ses_pausado_reputacion, COALESCE(federal_consultoria_cap_diario, 100)
    INTO v_activo, v_ses_pausado, v_cap
    FROM public.config_global LIMIT 1;

  -- Gate del flag maestro federal.
  IF NOT COALESCE(v_activo, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'gated_federal');
  END IF;
  -- El carril SES está pausado por reputación → no encolar más (el federal es SES-only).
  IF COALESCE(v_ses_pausado, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'ses_pausado');
  END IF;

  -- SECUENCIA: la campaña RPA CABA debe haber salido Y drenado por completo.
  IF NOT EXISTS (SELECT 1 FROM public.prospecto_mails WHERE template_slug = v_rpa)
     OR EXISTS (SELECT 1 FROM public.email_queue WHERE template_slug = v_rpa AND enviado_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'esperando_rpa');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = v_slug AND activo) THEN
    RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_slug);
  END IF;

  -- Cap diario propio: cuenta lo encolado hoy de consultoría.
  SELECT count(*) INTO v_hoy_count FROM public.email_queue q
   WHERE q.related_table = 'prospectos' AND q.template_slug = v_slug
     AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap);
  END IF;

  -- Siguiente elegible del universo nacional (import_nacional).
  SELECT p.id, p.nombre, p.email INTO v_p
  FROM public.prospectos p
  WHERE p.origen = 'import_nacional'
    AND p.convertido_at IS NULL AND p.baja_at IS NULL
    AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
    AND p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND p.email NOT LIKE '%.invalid'
    AND NOT public.email_esta_suprimido(p.email)
    AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm
                     WHERE pm.prospecto_id = p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM public.email_queue q2
                     WHERE q2.related_table = 'prospectos' AND q2.related_id = p.id
                       AND q2.created_at >= (v_hoy - v_gracia)::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm2
                     WHERE pm2.prospecto_id = p.id AND pm2.template_slug = v_slug
                       AND pm2.enviado_at >= (v_hoy - v_cooldown)::timestamptz)
  ORDER BY p.created_at, p.id
  LIMIT 1;

  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'sin_candidatos');
  END IF;

  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_slug AND activo;
  v_pila := COALESCE(public.nombre_pila_federal(v_p.nombre), 'colega');

  -- Prioridad 10: debajo de captación PBA (7), LexPH (8) y RPA CABA (9).
  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_slug, lower(trim(v_p.email)), initcap(v_p.nombre),
     jsonb_build_object('nombre', v_pila), 10, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_slug,
    'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $fn$;

REVOKE ALL ON FUNCTION public.federal_consultoria_tick() FROM public;
GRANT EXECUTE ON FUNCTION public.federal_consultoria_tick() TO service_role;

-- ───────────── Cron: */10 (igual que PBA). Idle hasta que RPA termine. ─────────────
SELECT cron.schedule('federal-consultoria-tick', '*/10 * * * *',
  $cron$ SELECT public.federal_consultoria_tick(); $cron$);
