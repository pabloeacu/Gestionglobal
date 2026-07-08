-- 0290 · Eventos fase 4: "pasar lista" para eventos presenciales/mixtos.
-- La asistencia online se computa por webhook de Zoom; para presencial la
-- gerencia marca manualmente. Staff-only.
CREATE OR REPLACE FUNCTION public.webinar_marcar_asistencia(
  p_inscripto_id uuid, p_asistio boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.webinar_inscriptos
     SET asistio = COALESCE(p_asistio, false),
         joined_at = CASE WHEN COALESCE(p_asistio, false) AND joined_at IS NULL THEN now() ELSE joined_at END
   WHERE id = p_inscripto_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.webinar_marcar_asistencia(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webinar_marcar_asistencia(uuid, boolean) TO authenticated, service_role;
