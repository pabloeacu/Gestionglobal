-- 0571_dgg220_registro_mail_solo_captacion.sql
-- =============================================================================
-- DGG-220 · §6 de 0570: acotar el registro de mails de prospecto a SÓLO captación.
-- 0570 filtró el trigger a 'captacion-%' OR 'webinar-%'. El §6 (2 agentes) marcó
-- que 'webinar-%' es demasiado amplio: incluye webinar-bienvenida-CLIENTE
-- (transaccional) y los recordatorios (a todo inscripto). Si un cliente/alumno
-- que comparte casilla con un prospecto se inscribe a un webinar, reintroduciría
-- en miniatura el mismo bug (marca al prospecto 'contactado' + gracia 30d).
-- Verificado: NINGÚN consumidor (UI/RPC) usa prospecto_mails/ultimo_mail para
-- webinars — sólo la captación los usa. Por eso acotamos a 'captacion-%' puro.
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

  -- Sólo campañas de captación. NO transaccionales, NO webinars (que van a
  -- clientes/inscriptos y podrían caer en una casilla compartida con un prospecto).
  IF COALESCE(NEW.template_slug,'') NOT LIKE 'captacion-%' THEN
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

-- Limpiar cualquier fila webinar-% que 0570 pudiera haber registrado (hoy 0).
DELETE FROM public.prospecto_mails WHERE COALESCE(template_slug,'') NOT LIKE 'captacion-%';
