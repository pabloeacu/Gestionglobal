-- 0736 · DGG-270 — Fix del gate de secuencia del goteo de consultoría (hallazgo del e2e propio).
-- El gate original de `federal_consultoria_tick` infería "la campaña RPA ya salió" de
-- `EXISTS prospecto_mails WHERE template_slug='federal-rpa-caba'`. Pero UNA sola fila suelta
-- (p.ej. el mail de PRUEBA premium que se le mandó a Pablo, que se registró contra su propio
-- prospecto padrón-PBA) ya hacía pasar el gate → consultoría podría arrancar ANTES de disparar la
-- campaña RPA real. Bug detectado por el e2e (`rpa_mails=1` sin haber disparado RPA).
--
-- Fix: gate por FLAG EXPLÍCITO `federal_consultoria_armada` (default false), que se prende SÓLO en
-- la operación que dispara la campaña RPA CABA. El tick corre cuando: flag maestro federal ON +
-- armada ON + RPA drenó (0 filas `federal-rpa-caba` pendientes, excluyendo terminalmente
-- fallidas/canceladas para no quedar bloqueado por una fila muerta). Robusto ante filas de prueba.

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS federal_consultoria_armada boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.config_global.federal_consultoria_armada IS
  'DGG-270: se prende al disparar la campaña RPA CABA. Habilita el goteo de consultoría (federal_consultoria_tick) una vez que RPA drenó. OFF por defecto.';

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
  v_activo boolean; v_armada boolean; v_ses_pausado boolean; v_cap int;
  v_hoy_count int; v_asunto text; v_p record; v_pila text;
BEGIN
  SELECT federal_campanas_activo, federal_consultoria_armada, ses_pausado_reputacion,
         COALESCE(federal_consultoria_cap_diario, 100)
    INTO v_activo, v_armada, v_ses_pausado, v_cap
    FROM public.config_global LIMIT 1;

  IF NOT COALESCE(v_activo, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'gated_federal');
  END IF;
  -- Armada: la prende la operación que dispara la campaña RPA. Sin esto, no arranca.
  IF NOT COALESCE(v_armada, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'no_armada');
  END IF;
  IF COALESCE(v_ses_pausado, false) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'ses_pausado');
  END IF;

  -- SECUENCIA: la campaña RPA CABA debe haber DRENADO (0 pendientes no-terminales).
  IF EXISTS (SELECT 1 FROM public.email_queue
             WHERE template_slug = v_rpa AND enviado_at IS NULL
               AND COALESCE(status, 'pending') NOT IN ('failed', 'cancelled')) THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'esperando_rpa');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = v_slug AND activo) THEN
    RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_slug);
  END IF;

  SELECT count(*) INTO v_hoy_count FROM public.email_queue q
   WHERE q.related_table = 'prospectos' AND q.template_slug = v_slug
     AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN
    RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap);
  END IF;

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