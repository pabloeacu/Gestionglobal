-- 0596_dgg227_hardening_s6.sql
-- DGG-227 · HARDENING §6 — fixes de la doble auditoría (3 agentes) de los
-- refinamientos del reporte de captación (0594) y del match por legajo (0595).
-- Ningún crítico; 4 mejoras menores capitalizadas antes de cerrar:
--
--  A#3 (Agente A): `v_bajas` se calculaba ALL-TIME pero se imprimía en la línea
--     "Entregabilidad" junto a rebotes/quejas (que son de 7d) y bajo un
--     "(sobre X enviados)" semanal → una vez que las bajas acumulen, leería como
--     una tasa semanal falsa. Fix: bajas de la SEMANA (baja_at >= now()-7d),
--     y se saca el denominador compartido (ver A#9).
--  A#9 / C#4: el cuerpo decía "%s mails enviados … (sobre %s enviados)" con DOS
--     fuentes distintas (prospecto_mails vs sent_emails); hoy coinciden pero
--     pueden divergir. Fix: se quita el "(sobre X enviados)" del cuerpo (el % de
--     rebote ya expresa la tasa; el denominador exacto queda en el JSON).
--  C#5: el rótulo "nuevos matriculados incorporados" podía leerse como "recién
--     matriculados"; se aclara a "incorporados al padrón".
--  B#2 / C#9: el match por legajo del trigger usaba `btrim` (no dígitos).
--     `administraciones.legajo_rpac` es texto libre (sus writers sólo hacen trim);
--     si un alta cargara un legajo con formato, el match fallaría en silencio
--     (fail-safe, pero sub-cuenta). Fix: normalizar a dígitos, igual que el
--     subsistema TRAMIX (DGG-225/226) y el propio import del padrón.
--
-- Reglas: R16 (CREATE OR REPLACE, firmas idénticas), R17 (SECDEF), R19.

-- ───────────────────────────────────────────────────────────────────────────
-- A) Reporte: bajas semanales + copy + sin denominador dual (A#3, A#9, C#4, C#5)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prospectos_reporte_semanal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_env_7d int; v_conv_total int; v_conv_7d int; v_bajas_7d int; v_bajas_total int;
  v_contactados int; v_sin_contactar int; v_cola int;
  v_reb_total int; v_reb_rebotes int; v_reb_quejas int; v_reb_pct numeric;
  v_nuevos_7d int; v_sembr_7d int; v_sembr_total int;
  v_activo boolean; v_pausado boolean; v_cuerpo text;
BEGIN
  SELECT count(*) INTO v_env_7d FROM public.prospecto_mails WHERE enviado_at >= now() - interval '7 days';
  SELECT count(*) INTO v_conv_total FROM public.prospectos WHERE origen='padron_pba' AND convertido_at IS NOT NULL;
  SELECT count(*) INTO v_conv_7d FROM public.prospectos WHERE origen='padron_pba' AND convertido_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas_7d FROM public.prospectos WHERE origen='padron_pba' AND baja_at >= now() - interval '7 days';
  SELECT count(*) INTO v_bajas_total FROM public.prospectos WHERE origen='padron_pba' AND baja_at IS NOT NULL;
  SELECT count(*) INTO v_contactados FROM public.prospectos WHERE origen='padron_pba' AND ultimo_mail_at IS NOT NULL;
  SELECT count(*) INTO v_sin_contactar FROM public.prospectos
    WHERE origen='padron_pba' AND convertido_at IS NULL AND baja_at IS NULL
      AND email NOT LIKE '%@padron.invalid' AND ultimo_mail_at IS NULL;
  SELECT count(*) INTO v_cola FROM public.email_queue WHERE related_table='prospectos' AND enviado_at IS NULL;

  SELECT count(*),
         count(*) FILTER (WHERE estado='bounced'),
         count(*) FILTER (WHERE estado='complained')
    INTO v_reb_total, v_reb_rebotes, v_reb_quejas
    FROM public.sent_emails
    WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  v_reb_pct := CASE WHEN v_reb_total > 0 THEN round(v_reb_rebotes::numeric/v_reb_total*100, 1) ELSE 0 END;

  SELECT count(*) INTO v_nuevos_7d
    FROM public.prospectos WHERE origen='padron_pba' AND created_at >= now() - interval '7 days';

  SELECT count(*) INTO v_sembr_7d FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at AND pm.template_slug LIKE 'captacion-%');
  SELECT count(*) INTO v_sembr_total FROM public.prospectos p
    WHERE p.origen='padron_pba' AND p.convertido_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = p.id AND pm.enviado_at IS NOT NULL
                    AND pm.enviado_at <= p.convertido_at AND pm.template_slug LIKE 'captacion-%');

  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false)
    INTO v_activo, v_pausado FROM public.config_global LIMIT 1;

  v_cuerpo := format(
    'Semana de captación: %s mails enviados · %s nuevos matriculados incorporados al padrón · conversiones %s nuevas (%s total), sembradas por campaña %s (%s total). Entregabilidad: %s rebotes (%s%%) · %s quejas de spam · %s bajas voluntarias. Faltan contactar %s · en cola %s. Motor: %s%s.',
    v_env_7d, v_nuevos_7d, v_conv_7d, v_conv_total, v_sembr_7d, v_sembr_total,
    v_reb_rebotes, v_reb_pct, v_reb_quejas, v_bajas_7d,
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
    'bajas_7d', v_bajas_7d, 'bajas_total', v_bajas_total,
    'contactados', v_contactados, 'sin_contactar', v_sin_contactar, 'cola', v_cola,
    'rebotes', v_reb_rebotes, 'quejas_spam', v_reb_quejas, 'rebotes_pct', v_reb_pct,
    'enviados_medidos', v_reb_total, 'motor_activo', v_activo, 'motor_pausado', v_pausado);
END $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- B) Trigger de conversión: normalizar el legajo a dígitos (B#2 / C#9)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.prospecto_detectar_conversion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cuit text; v_email text; v_legajo text;
BEGIN
  v_cuit   := regexp_replace(COALESCE(NEW.cuit, ''), '[^0-9]', '', 'g');
  v_email  := lower(btrim(COALESCE(NEW.email, '')));
  v_legajo := regexp_replace(COALESCE(NEW.legajo_rpac, ''), '[^0-9]', '', 'g');
  IF v_cuit = '' AND v_email = '' AND v_legajo = '' THEN RETURN NULL; END IF;
  UPDATE public.prospectos p
     SET convertido_a_administracion_id = NEW.id, convertido_at = COALESCE(p.convertido_at, now()),
         estado_captacion = 'convertido', updated_at = now()
   WHERE p.convertido_a_administracion_id IS NULL
     AND ( (v_cuit   <> '' AND p.cuit   = v_cuit)
        OR (v_email  <> '' AND p.email  = v_email)
        OR (v_legajo <> '' AND regexp_replace(COALESCE(p.legajo,''), '[^0-9]', '', 'g') = v_legajo) );
  RETURN NULL;
END $function$;
