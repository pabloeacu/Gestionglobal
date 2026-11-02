-- ============================================================================
-- Mig 0631 · DGG-237 · Visibilidad proactiva de la reputación del frío.
--
-- El breaker de auto-pausa por reputación YA existe y opera (prospectos_campana_tick:
-- si en 7d los captacion-% tienen >5% de bounced/complained con ≥20 envíos → pausa
-- el frío + avisa a gerentes). Pero el panel de captación sólo mostraba el estado
-- DESPUÉS de saltar (pausado_motivo). Acá exponemos la tasa EN VIVO (misma fuente y
-- misma fórmula que el breaker) para que gerencia vea la reputación acercándose al
-- umbral ANTES de que se dispare la auto-pausa, y pueda actuar (sanear padrón, bajar
-- cap, pausar a mano). Sólo lectura: no cambia ningún comportamiento de envío.
--
-- CREATE OR REPLACE sin cambio de firma (jsonb) → R16-safe (sigue habiendo 1 sola
-- prospectos_captacion_kpis) y conserva los grants existentes. SECDEF staff-gated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prospectos_captacion_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_motivo text; v_cap int;
  v_rep_total int; v_rep_bad int;
  v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false),
         prospectos_pausado_motivo, COALESCE(prospectos_cap_diario,50)
    INTO v_activo, v_pausado, v_motivo, v_cap FROM public.config_global LIMIT 1;

  -- Reputación en vivo: MISMA ventana/fuente/filtro que el breaker del tick
  -- (prospectos_campana_tick): captacion-% enviados en los últimos 7 días.
  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_rep_total, v_rep_bad
    FROM public.sent_emails
   WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';

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
    'pausado',           v_pausado,
    'pausado_motivo',    v_motivo,
    'cap_diario',        v_cap,
    'encolados_hoy',     (SELECT count(*) FROM public.email_queue WHERE related_table='prospectos'
                            AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'cola_pendiente',    (SELECT count(*) FROM public.email_queue WHERE related_table='prospectos' AND enviado_at IS NULL),
    'enviados_total',    (SELECT count(*) FROM public.prospecto_mails),
    'hoy',               v_hoy,
    'enriquecidos',      (SELECT count(*) FROM public.prospecto_padron WHERE tramix_at IS NOT NULL),
    'enrich_pendientes', (SELECT count(*) FROM public.prospecto_tramix_queue WHERE estado = 'pendiente'),
    'padron_total',      (SELECT count(*) FROM public.prospecto_padron),
    -- Reputación del frío (visibilidad proactiva, DGG-237):
    'rep_7d_total',      v_rep_total,
    'rep_7d_bad',        v_rep_bad,
    'rep_7d_pct',        CASE WHEN v_rep_total > 0 THEN round(v_rep_bad::numeric / v_rep_total * 100, 1) ELSE 0 END,
    'rep_umbral_pct',    5,          -- debe coincidir con el breaker del tick
    'rep_min_muestra',   20          -- el breaker sólo pausa con ≥20 envíos medidos
  );
END $function$;