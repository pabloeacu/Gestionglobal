-- 0289 · Eventos fase 3: emails modality-aware. webinar_email_vars ahora resuelve
-- canal_humano para 'presencial' (antes caía en "YouTube Live", confuso) e incluye
-- el lugar/dirección inline + variables de ubicación disponibles para templates.
-- Misma firma → CREATE OR REPLACE. El link de acceso (que ya muestra el lugar +
-- mapa para presencial, fase 3) se mantiene.

CREATE OR REPLACE FUNCTION private.webinar_email_vars(p_inscripto_id uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_ins record; v_web record; v_base_url text;
  v_canal_human text; v_fecha_human text;
  v_es_cliente boolean; v_es_prospecto boolean;
  v_donde text;
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = p_inscripto_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = v_ins.webinar_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT COALESCE(NULLIF(sitio_web, ''), 'https://gestionglobal.ar') INTO v_base_url
    FROM public.config_global LIMIT 1;
  IF v_base_url IS NULL THEN v_base_url := 'https://gestionglobal.ar'; END IF;

  v_canal_human := CASE v_ins.canal
    WHEN 'zoom' THEN 'Zoom (con asistencia automática)'
    WHEN 'youtube' THEN 'YouTube Live'
    WHEN 'presencial' THEN 'Presencial'
      || COALESCE(' · ' || NULLIF(v_web.ubicacion_lugar, ''), '')
      || COALESCE(' (' || NULLIF(v_web.ubicacion_direccion, '') || ')', '')
    ELSE v_ins.canal
  END;

  -- Bloque multi-línea "Dónde" (vacío para online → no molesta en el template).
  v_donde := CASE WHEN v_ins.canal = 'presencial' THEN
      'Dónde: '
      || COALESCE(NULLIF(v_web.ubicacion_lugar, '') || E'\n', '')
      || COALESCE(NULLIF(v_web.ubicacion_direccion, ''), '')
      || COALESCE(', ' || NULLIF(v_web.ubicacion_localidad, ''), '')
      || COALESCE(E'\n' || NULLIF(v_web.ubicacion_instrucciones, ''), '')
      || COALESCE(E'\nMapa: ' || NULLIF(v_web.ubicacion_mapa_url, ''), '')
    ELSE '' END;

  v_fecha_human := to_char(v_web.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires', 'TMDay DD "de" TMMonth, HH24:MI "hs"');
  v_es_cliente := v_ins.administracion_id IS NOT NULL;
  v_es_prospecto := v_ins.prospecto_id IS NOT NULL;
  RETURN jsonb_build_object(
    'nombre', v_ins.nombre_snapshot,
    'webinar_titulo', v_web.titulo,
    'webinar_descripcion', COALESCE(v_web.descripcion, ''),
    'fecha_hora', v_web.fecha_hora,
    'fecha_humana', v_fecha_human,
    'duracion_min', v_web.duracion_min,
    'canal', v_ins.canal,
    'canal_humano', v_canal_human,
    'modalidad', v_web.modalidad,
    'es_presencial', (v_ins.canal = 'presencial'),
    'donde', v_donde,
    'ubicacion_lugar', COALESCE(v_web.ubicacion_lugar, ''),
    'ubicacion_direccion', COALESCE(v_web.ubicacion_direccion, ''),
    'ubicacion_mapa_url', COALESCE(v_web.ubicacion_mapa_url, ''),
    'link_acceso', v_base_url || '/campus/webinar/' || p_token,
    'link_acceso_directo', v_base_url || '/webinar/' || p_token,
    'es_cliente', v_es_cliente,
    'es_prospecto', v_es_prospecto
  );
END $function$;
