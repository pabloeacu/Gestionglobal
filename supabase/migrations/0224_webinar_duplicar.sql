-- Duplicar un webinar: clona la fila como BORRADOR (publicado=false, status=programado),
-- copiando título "… (copia)", descripción, fecha, duración, docentes, banner, cert config
-- y el formulario_id (form de evento COMPARTIDO — no se clona el form). NO copia la sala
-- Zoom/Webex/YouTube (se crea de nuevo) ni inscriptos/asistencias/certificados (por-persona).
CREATE OR REPLACE FUNCTION public.webinar_duplicar(p_webinar_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede duplicar webinars' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.webinars WHERE id = p_webinar_id) THEN
    RAISE EXCEPTION 'Webinar no encontrado' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.webinars
    (titulo, descripcion, fecha_hora, duracion_min, formulario_id, status, plataforma,
     cupo_zoom, cert_esquema_id, cert_emite, banner_url, docentes, publicado, creado_por)
  SELECT titulo || ' (copia)', descripcion, fecha_hora, duracion_min, formulario_id,
     'programado', plataforma, cupo_zoom, cert_esquema_id, cert_emite, banner_url, docentes,
     false, auth.uid()
  FROM public.webinars WHERE id = p_webinar_id
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.webinar_duplicar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webinar_duplicar(uuid) TO authenticated;
