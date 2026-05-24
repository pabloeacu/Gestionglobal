-- 0054 · fecha en español hardcoded (no depende del locale del servidor).
-- to_char TM modifier usa locale del servidor (en_US en Supabase) → fecha
-- en inglés. Fix con arrays explícitos ES.

CREATE OR REPLACE FUNCTION private.webinar_email_vars(
  p_inscripto_id uuid,
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ins record;
  v_web record;
  v_base_url text;
  v_canal_human text;
  v_fecha_human text;
  v_fecha_arg timestamp;
  v_dia_semana text;
  v_mes text;
  v_dias text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_meses text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
BEGIN
  SELECT * INTO v_ins FROM public.webinar_inscriptos WHERE id = p_inscripto_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT * INTO v_web FROM public.webinars WHERE id = v_ins.webinar_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT NULLIF(sitio_web, '') INTO v_base_url FROM public.config_global LIMIT 1;
  IF v_base_url IS NULL THEN
    v_base_url := 'https://gestionglobal.ar';
  ELSIF v_base_url NOT LIKE 'http%' THEN
    v_base_url := 'https://' || v_base_url;
  END IF;

  v_canal_human := CASE WHEN v_ins.canal = 'zoom' THEN 'Zoom (con asistencia automática)' ELSE 'YouTube Live' END;
  v_fecha_arg := (v_web.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::timestamp;
  v_dia_semana := v_dias[EXTRACT(DOW FROM v_fecha_arg)::int + 1];
  v_mes := v_meses[EXTRACT(MONTH FROM v_fecha_arg)::int];
  v_fecha_human := initcap(v_dia_semana) || ' ' ||
                   to_char(v_fecha_arg, 'DD') || ' de ' || v_mes || ', ' ||
                   to_char(v_fecha_arg, 'HH24:MI') || ' hs';

  RETURN jsonb_build_object(
    'nombre', v_ins.nombre_snapshot,
    'webinar_titulo', v_web.titulo,
    'webinar_descripcion', COALESCE(v_web.descripcion, ''),
    'fecha_hora', v_web.fecha_hora,
    'fecha_humana', v_fecha_human,
    'duracion_min', v_web.duracion_min,
    'canal', v_ins.canal,
    'canal_humano', v_canal_human,
    'link_acceso', v_base_url || '/webinar/' || p_token
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION private.webinar_email_vars(uuid, text) FROM PUBLIC, anon, authenticated;
