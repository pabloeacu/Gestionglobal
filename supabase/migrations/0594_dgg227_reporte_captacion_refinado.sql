-- 0594_dgg227_reporte_captacion_refinado.sql
-- DGG-227 · Refinamientos del "Reporte semanal · Captación PBA" (pedido de Pablo
-- al leer el reporte). Tres cambios, todos cosméticos/aditivos sobre el cuerpo
-- del aviso — NO tocan schema ni datos:
--
--  A) SEPARAR rebotes vs quejas vs bajas. Antes el reporte sumaba
--     estado IN ('bounced','complained') en una sola cifra "rebotes/quejas".
--     Pablo (correcto): un REBOTE es un error del correo del destinatario (ajeno
--     a nosotros); una QUEJA de spam (complained) es alguien que marcó el mail
--     como spam; y una BAJA voluntaria (baja_at, por el link de unsubscribe) es
--     otra cosa. Ahora van en 3 cifras. (El dato ya estaba por fila; `v_bajas`
--     ya se calculaba pero no se imprimía.)
--  B) NUEVOS matriculados incorporados al padrón en la semana (del re-import
--     DGG-221; arranca a correr el 21/10). Métrica nueva: prospectos origen
--     'padron_pba' creados en los últimos 7 días.
--  D) CONVERSIONES SEMBRADAS por campaña (idea de Pablo): de las conversiones,
--     cuántas habían recibido ANTES un mail de captación (semilla plantada),
--     sin importar si el mail fue la causa directa. `prospecto_mails` es
--     captación-only (4 slugs captacion-*), así que "sembrada" = el prospecto
--     convertido tiene un mail de campaña con enviado_at <= convertido_at.
--
-- Reglas: R16 (CREATE OR REPLACE, firma () idéntica), R19 (métricas sobre el
-- universo, sin filtro de UI).

CREATE OR REPLACE FUNCTION public.prospectos_reporte_semanal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_env_7d int; v_conv_total int; v_conv_7d int; v_bajas int;
  v_contactados int; v_sin_contactar int; v_cola int;
  v_reb_total int; v_reb_rebotes int; v_reb_quejas int; v_reb_pct numeric;
  v_nuevos_7d int; v_sembr_7d int; v_sembr_total int;
  v_activo boolean; v_pausado boolean; v_cuerpo text;
BEGIN
  SELECT count(*) INTO v_env_7d FROM public.prospecto_mails WHERE enviado_at >= now() - interval '7 days';
  SELECT count(*) INTO v_conv_total FROM public.prospectos WHERE origen='padron_pba' AND convertido_at IS NOT NULL;
  SELECT count(*) INTO v_conv_7d FROM public.prospectos WHERE origen='padron_pba' AND convertido_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas FROM public.prospectos WHERE origen='padron_pba' AND baja_at IS NOT NULL;
  SELECT count(*) INTO v_contactados FROM public.prospectos WHERE origen='padron_pba' AND ultimo_mail_at IS NOT NULL;
  SELECT count(*) INTO v_sin_contactar FROM public.prospectos
    WHERE origen='padron_pba' AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid' AND ultimo_mail_at IS NULL;
  SELECT count(*) INTO v_cola FROM public.email_queue WHERE related_table='prospectos' AND enviado_at IS NULL;

  -- A) rebotes (bounced) vs quejas de spam (complained), separados
  SELECT count(*),
         count(*) FILTER (WHERE estado='bounced'),
         count(*) FILTER (WHERE estado='complained')
    INTO v_reb_total, v_reb_rebotes, v_reb_quejas
    FROM public.sent_emails
    WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  v_reb_pct := CASE WHEN v_reb_total > 0 THEN round(v_reb_rebotes::numeric/v_reb_total*100, 1) ELSE 0 END;

  -- B) nuevos matriculados incorporados al padrón en la semana
  SELECT count(*) INTO v_nuevos_7d
    FROM public.prospectos WHERE origen='padron_pba' AND created_at >= now() - interval '7 days';

  -- D) conversiones "sembradas": recibieron un mail de campaña antes de convertirse
  SELECT count(*) INTO v_sembr_7d FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at
                    AND pm.template_slug LIKE 'captacion-%');
  SELECT count(*) INTO v_sembr_total FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at
                    AND pm.template_slug LIKE 'captacion-%');

  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false)
    INTO v_activo, v_pausado FROM public.config_global LIMIT 1;

  v_cuerpo := format(
    'Semana de captación: %s mails enviados · %s nuevos matriculados incorporados · conversiones %s nuevas (%s total), sembradas por campaña %s (%s total). Entregabilidad: %s rebotes (%s%% casillas con error) · %s quejas de spam · %s bajas voluntarias (sobre %s enviados). Faltan contactar %s · en cola %s. Motor: %s%s.',
    v_env_7d, v_nuevos_7d, v_conv_7d, v_conv_total, v_sembr_7d, v_sembr_total,
    v_reb_rebotes, v_reb_pct, v_reb_quejas, v_bajas, v_reb_total,
    v_sin_contactar, v_cola,
    CASE WHEN v_activo THEN 'activo' ELSE 'apagado' END,
    CASE WHEN v_pausado THEN ' (auto-pausado por reputación)' ELSE '' END);

  PERFORM public.notify_all_gerentes(
    'prospectos_reporte_semanal', 'Reporte semanal · Captación PBA', v_cuerpo,
    '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, true);

  RETURN jsonb_build_object(
    'enviados_7d', v_env_7d, 'nuevos_padron_7d', v_nuevos_7d,
    'conversiones_7d', v_conv_7d, 'conversiones_total', v_conv_total,
    'conversiones_sembradas_7d', v_sembr_7d, 'conversiones_sembradas_total', v_sembr_total,
    'bajas', v_bajas, 'contactados', v_contactados, 'sin_contactar', v_sin_contactar, 'cola', v_cola,
    'rebotes', v_reb_rebotes, 'quejas_spam', v_reb_quejas, 'rebotes_pct', v_reb_pct,
    'enviados_medidos', v_reb_total, 'motor_activo', v_activo, 'motor_pausado', v_pausado);
END $function$;
