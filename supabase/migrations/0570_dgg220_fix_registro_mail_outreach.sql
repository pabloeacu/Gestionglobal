-- 0570_dgg220_fix_registro_mail_outreach.sql
-- =============================================================================
-- DGG-220 · FIX del registro de mails de prospecto (bug del "último mail").
-- El trigger private.prospecto_registrar_mail() (AFTER INSERT ON sent_emails,
-- 0546) matcheaba el prospecto SÓLO por dirección de email, SIN filtrar el tipo
-- de mail. Resultado: cuando un prospecto comparte casilla con un cliente o le
-- escribe a gerencia, se le registraban los TRANSACCIONALES (gerencia-notif-
-- generica, tracking, ofrecimientos, constancias…) como si fueran campañas:
--   · "último mail" mostraba un transaccional (p.ej. "Resumen de agentes");
--   · estado_captacion pasaba a 'contactado' sin haberlo contactado;
--   · y —lo grave— prospecto_mails es la tabla que leen los gates de
--     elegibilidad (gracia 30d / cooldown 90d) → el prospecto quedaba
--     AUTO-EXCLUIDO de las campañas 30 días sin motivo.
--
-- FIX: el trigger registra SÓLO outreach de prospecto (captacion-% / webinar-%),
-- nunca transaccionales. + backfill: borra el ruido histórico de prospecto_mails,
-- recalcula prospectos.ultimo_mail_* y revierte estado_captacion='contactado'
-- de los que quedaron así por ruido.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.prospecto_registrar_mail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pid uuid;
BEGIN
  IF NEW.to_email IS NULL THEN RETURN NULL; END IF;

  -- Sólo registrar OUTREACH de prospecto (campañas de captación + webinars). Los
  -- transaccionales que caen en una casilla que coincide con la de un prospecto
  -- NO cuentan como contacto de captación (si no, contaminan el log y auto-excluyen).
  IF NOT (COALESCE(NEW.template_slug,'') LIKE 'captacion-%'
          OR COALESCE(NEW.template_slug,'') LIKE 'webinar-%') THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_pid FROM public.prospectos WHERE email = lower(btrim(NEW.to_email)) LIMIT 1;
  IF v_pid IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.prospecto_mails (prospecto_id, template_slug, asunto, enviado_at)
  VALUES (v_pid, NEW.template_slug, NEW.asunto, COALESCE(NEW.enviado_at, now()));

  UPDATE public.prospectos
     SET ultimo_mail_slug = NEW.template_slug, ultimo_mail_asunto = NEW.asunto,
         ultimo_mail_at = COALESCE(NEW.enviado_at, now()),
         estado_captacion = CASE WHEN estado_captacion = 'nuevo' THEN 'contactado' ELSE estado_captacion END,
         updated_at = now()
   WHERE id = v_pid;
  RETURN NULL;
END $function$;

-- -----------------------------------------------------------------------------
-- BACKFILL (one-time, idempotente).
-- -----------------------------------------------------------------------------
-- 1) Borrar el ruido histórico (no-outreach) de prospecto_mails.
DELETE FROM public.prospecto_mails
 WHERE COALESCE(template_slug,'') NOT LIKE 'captacion-%'
   AND COALESCE(template_slug,'') NOT LIKE 'webinar-%';

-- 2a) Recalcular ultimo_mail_* desde el último outreach que quede.
UPDATE public.prospectos p SET
  ultimo_mail_slug   = lm.template_slug,
  ultimo_mail_asunto = lm.asunto,
  ultimo_mail_at     = lm.enviado_at
FROM (
  SELECT DISTINCT ON (prospecto_id) prospecto_id, template_slug, asunto, enviado_at
  FROM public.prospecto_mails
  ORDER BY prospecto_id, enviado_at DESC
) lm
WHERE p.id = lm.prospecto_id
  AND (p.ultimo_mail_slug   IS DISTINCT FROM lm.template_slug
       OR p.ultimo_mail_at     IS DISTINCT FROM lm.enviado_at
       OR p.ultimo_mail_asunto IS DISTINCT FROM lm.asunto);

-- 2b) Limpiar ultimo_mail_* de los que se quedaron sin ningún outreach.
UPDATE public.prospectos p SET
  ultimo_mail_slug = NULL, ultimo_mail_asunto = NULL, ultimo_mail_at = NULL
WHERE p.ultimo_mail_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id);

-- 3) Revertir estado_captacion='contactado' → 'nuevo' en los que quedaron así por
--    ruido (sin ningún outreach real). Preserva 'convertido'/'no_interesado'/'baja'.
UPDATE public.prospectos SET estado_captacion = 'nuevo'
 WHERE estado_captacion = 'contactado'
   AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = prospectos.id);
