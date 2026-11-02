-- 0628_dgg221_motor_no_reencolar_fallidos.sql
-- DGG-221 · Captación PBA — fix de raíz del re-encolado de direcciones fallidas
-- + saneo de emails del padrón estructuralmente inválidos.
-- --------------------------------------------------------------------------
-- BUG (E-GG-242): el motor `prospectos_campana_tick` excluía por cola sólo las
-- filas con `enviado_at IS NULL` (pendientes). Una fila FALLIDA queda con
-- `enviado_at` seteado y status='failed', así que NO la frenaba; y como un
-- envío fallido NO escribe `prospecto_mails`, tampoco aplicaba la gracia de 30d
-- por esa vía. Resultado: un prospecto con email mal formado ("no tiene mail")
-- se re-encolaba en CADA tick, consumiendo cupos del cap (106 fallos acumulados
-- = 1 solo registro re-encolado; 17 en un día). Con el tick acelerado a */10
-- (144/día) el desperdicio se multiplicaría.
-- FIX: la compuerta de cola pasa a excluir CUALQUIER fila de email_queue del
-- prospecto en la ventana de gracia (sent/pending/failed) → un fallo frena el
-- reintento 30 días (≈1 intento/mes en vez de 144/día). Cambio de 1 línea,
-- misma firma (R16 ok: sin overload). El resto del cuerpo queda idéntico.
-- SANEO: neutralizar emails del padrón que no son direcciones válidas
-- (estructuralmente), moviéndolos al sentinel `@padron.invalid` que el motor ya
-- excluye, preservando el original en `observaciones`. Idempotente.
-- --------------------------------------------------------------------------

-- 1) Saneo de datos (general + idempotente).
UPDATE public.prospectos p
   SET observaciones = concat_ws(' | ', nullif(p.observaciones,''),
         'email padrón inválido ('||p.email||') neutralizado DGG-221'),
       email = 'invalido-'||left(p.id::text,8)||'@padron.invalid',
       updated_at = now()
 WHERE p.origen = 'padron_pba'
   AND p.email NOT ILIKE '%@padron.invalid'
   AND p.email !~* '^[^@[:space:],;/]+@[^@[:space:],;/]+\.[a-z]{2,}$';

-- 2) Fix del motor: la compuerta de cola excluye cualquier fila reciente
--    (sent/pending/failed), no sólo las pendientes.
CREATE OR REPLACE FUNCTION public.prospectos_campana_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
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
      SELECT p.id, p.nombre, p.email, p.matricula_vencimiento, p.en_tramite,
             public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg
      FROM public.prospectos p
      WHERE p.origen='padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
        AND p.email NOT LIKE '%@padron.invalid'
        AND NOT public.email_esta_suprimido(p.email)
        AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
        AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
        AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM public.email_queue q WHERE q.related_table='prospectos' AND q.related_id=p.id AND q.created_at >= (v_hoy - v_gracia)::timestamptz)
    ), nx AS (
      SELECT e.*,
        CASE e.seg WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                   WHEN 'curso_31_90' THEN 'captacion-curso-3190'
                   WHEN 'vencida' THEN 'captacion-vencida' END AS venc_tpl,
        (SELECT count(*) FROM public.prospecto_mails pm WHERE pm.prospecto_id=e.id) AS n_mails
      FROM elig e
    ), nx2 AS (
      SELECT n.*,
        (n.venc_tpl IS NOT NULL AND NOT n.en_tramite AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=n.venc_tpl)) AS venc_pending,
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

  v_pila := public.prospecto_nombre_pila(v_p.nombre);
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
END $function$;

REVOKE ALL ON FUNCTION public.prospectos_campana_tick() FROM PUBLIC, anon, authenticated;
