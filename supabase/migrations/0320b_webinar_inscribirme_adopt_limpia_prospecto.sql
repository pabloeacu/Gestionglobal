-- 0320b · Hotfix del 0320 descubierto por el e2e (§6): al ADOPTAR una fila de
-- prospecto (prospecto_id NOT NULL, administracion_id NULL) via ON CONFLICT DO
-- UPDATE, había que LIMPIAR prospecto_id además de setear administracion_id —
-- si no, la fila resultante queda con ambos seteados y viola el check
-- webinar_inscriptos_identidad_xor. Consolidado acá (CREATE OR REPLACE idempotente).
CREATE OR REPLACE FUNCTION public.cliente_webinar_inscribirme(p_webinar_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp', 'auth'
AS $function$
DECLARE
  v_admin_id uuid;
  v_user_id  uuid := auth.uid();
  v_user_row record;
  v_inscripcion_id uuid;
  v_webinar record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'sin administracion asociada al usuario' USING ERRCODE = '22023';
  END IF;

  SELECT id, titulo, status, fecha_hora INTO v_webinar
  FROM public.webinars
  WHERE id = p_webinar_id
    AND status IN ('programado','en_curso');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webinar no disponible' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_inscripcion_id
  FROM public.webinar_inscriptos
  WHERE webinar_id = p_webinar_id AND administracion_id = v_admin_id
  LIMIT 1;
  IF v_inscripcion_id IS NOT NULL THEN
    RETURN v_inscripcion_id;
  END IF;

  SELECT u.email, COALESCE(p.full_name, split_part(u.email, '@', 1)) AS full_name, u.phone
    INTO v_user_row
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user_id;

  INSERT INTO public.webinar_inscriptos (
    webinar_id, administracion_id, profile_id,
    email_snapshot, nombre_snapshot, telefono_snapshot,
    canal, inscripto_at
  ) VALUES (
    p_webinar_id, v_admin_id, v_user_id,
    v_user_row.email, v_user_row.full_name, v_user_row.phone,
    'zoom', now()
  )
  ON CONFLICT (webinar_id, email_snapshot) DO UPDATE
    SET administracion_id = EXCLUDED.administracion_id,
        profile_id       = EXCLUDED.profile_id,
        prospecto_id     = NULL   -- respeta webinar_inscriptos_identidad_xor
  RETURNING id INTO v_inscripcion_id;

  RETURN v_inscripcion_id;
END;
$function$;
