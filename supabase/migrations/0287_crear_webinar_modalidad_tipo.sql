-- 0287 · crear_webinar acepta modalidad + tipo al alta (el resto de la config
-- presencial/arancel se edita en el detalle vía UPDATE). R16: DROP+CREATE.
DROP FUNCTION IF EXISTS public.crear_webinar(text, text, timestamptz, integer, integer, uuid, text, text);

CREATE FUNCTION public.crear_webinar(
  p_titulo text, p_descripcion text, p_fecha_hora timestamptz,
  p_duracion_min integer DEFAULT 60, p_cupo_zoom integer DEFAULT 100,
  p_formulario_id uuid DEFAULT NULL, p_youtube_live_url text DEFAULT NULL,
  p_plataforma text DEFAULT 'zoom',
  p_modalidad text DEFAULT 'online', p_tipo text DEFAULT 'webinar'
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_titulo IS NULL OR length(trim(p_titulo)) = 0 THEN
    RAISE EXCEPTION 'titulo requerido' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_hora IS NULL THEN
    RAISE EXCEPTION 'fecha_hora requerida' USING ERRCODE = '22023';
  END IF;
  IF p_plataforma NOT IN ('zoom','webex') THEN
    RAISE EXCEPTION 'plataforma inválida' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_modalidad,'online') NOT IN ('online','presencial','mixto') THEN
    RAISE EXCEPTION 'modalidad inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.webinars (
    titulo, descripcion, fecha_hora, duracion_min,
    cupo_zoom, formulario_id, youtube_live_url, plataforma,
    modalidad, tipo, creado_por
  ) VALUES (
    trim(p_titulo), p_descripcion, p_fecha_hora, COALESCE(p_duracion_min, 60),
    p_cupo_zoom, p_formulario_id, p_youtube_live_url, p_plataforma,
    COALESCE(p_modalidad,'online'), COALESCE(p_tipo,'webinar'), auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_webinar(text,text,timestamptz,integer,integer,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_webinar(text,text,timestamptz,integer,integer,uuid,text,text,text,text) TO authenticated, service_role;
