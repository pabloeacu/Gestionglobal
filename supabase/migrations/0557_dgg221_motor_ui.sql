-- 0557_dgg221_motor_ui.sql
-- =============================================================================
-- DGG-221 · Soporte UI del panel del motor: extiende los KPIs con el estado del
-- motor (activo/pausado/cap/progreso de hoy/cola) y agrega un RPC staff para
-- pausar/reanudar el motor a mano (sin perder el estado "activo").
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prospectos_captacion_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_motivo text; v_cap int;
  v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false),
         prospectos_pausado_motivo, COALESCE(prospectos_cap_diario,50)
    INTO v_activo, v_pausado, v_motivo, v_cap FROM public.config_global LIMIT 1;

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
    'padron_total',      (SELECT count(*) FROM public.prospecto_padron)
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_captacion_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_captacion_kpis() TO authenticated, service_role;

-- Pausar / reanudar el motor a mano (staff). No toca el flag `activo`.
CREATE OR REPLACE FUNCTION public.prospectos_motor_pausar(p_pausar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.config_global
     SET prospectos_pausado_reputacion = p_pausar,
         prospectos_pausado_motivo = CASE WHEN p_pausar THEN 'Pausado manualmente por gerencia.' ELSE NULL END;
  RETURN jsonb_build_object('ok', true, 'pausado', p_pausar);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_motor_pausar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_motor_pausar(boolean) TO authenticated, service_role;
