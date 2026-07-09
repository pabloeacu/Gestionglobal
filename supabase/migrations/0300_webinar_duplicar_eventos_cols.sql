-- 0300 · Fix §6 (Agente A, #1+#2): webinar_duplicar (mig 0224) sólo copiaba las
-- columnas viejas de webinar → duplicar un evento PERDÍA en silencio: flyer_url
-- (nuevo, 0293) + toda la data de Eventos de la fase DGG-99 (modalidad, tipo,
-- ubicacion_*, cupo_presencial, arancel_*). Duplicar un presencial arancelado
-- daba un online gratis sin lugar. Se agregan todas al SELECT/INSERT.
-- Misma firma (uuid) → CREATE OR REPLACE (sin overload, R16).
CREATE OR REPLACE FUNCTION public.webinar_duplicar(p_webinar_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new uuid;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo gerencia puede duplicar eventos' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.webinars WHERE id = p_webinar_id) THEN
    RAISE EXCEPTION 'Evento no encontrado' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.webinars
    (titulo, descripcion, fecha_hora, duracion_min, formulario_id, status, plataforma,
     cupo_zoom, cert_esquema_id, cert_emite, banner_url, flyer_url, docentes, publicado, creado_por,
     modalidad, tipo, ubicacion_lugar, ubicacion_direccion, ubicacion_localidad,
     ubicacion_mapa_url, ubicacion_instrucciones, cupo_presencial,
     es_arancelado, arancel_monto, arancel_nota)
  SELECT titulo || ' (copia)', descripcion, fecha_hora, duracion_min, formulario_id,
     'programado', plataforma, cupo_zoom, cert_esquema_id, cert_emite, banner_url, flyer_url, docentes,
     false, auth.uid(),
     modalidad, tipo, ubicacion_lugar, ubicacion_direccion, ubicacion_localidad,
     ubicacion_mapa_url, ubicacion_instrucciones, cupo_presencial,
     es_arancelado, arancel_monto, arancel_nota
  FROM public.webinars WHERE id = p_webinar_id
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$function$;