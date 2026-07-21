-- 0368 · E-GG-143: curso_encuentro_set_zoom era el 5° caller service_role que
-- la auditoría de E-GG-127 no atrapó. La edge fn zoom-encuentro-create crea la
-- sala en Zoom y persiste vía esta RPC con SERVICE_ROLE_KEY (sin JWT de
-- usuario): auth.uid() = NULL → private.is_staff() = false (post E-GG-123) →
-- la RPC abortaba → sala huérfana en Zoom + "no pudimos guardarla en el curso.
-- Avisá a un gerente" (caso real: JL, Encuentro Agosto 31/08/2026).
-- Mismo fix que mig 0348: is_staff_or_service() (la edge fn ya valida rol
-- gerente ANTES de llamar a Zoom; el service_role solo vive server-side, R3).
-- Barrido definitivo verificado: era la ÚNICA RPC llamada por edge fns con
-- service_role que conservaba el guard is_staff() puro.
CREATE OR REPLACE FUNCTION public.curso_encuentro_set_zoom(
  p_encuentro_id uuid, p_meeting_id bigint, p_join_url text,
  p_start_url text, p_password text, p_duracion_min integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden: solo staff puede asignar la reunión Zoom';
  END IF;
  UPDATE public.curso_encuentros
     SET zoom_meeting_id = p_meeting_id,
         zoom_join_url   = p_join_url,
         zoom_start_url  = p_start_url,
         zoom_password   = p_password,
         duracion_min    = COALESCE(p_duracion_min, duracion_min),
         zoom_status     = 'programado'
   WHERE id = p_encuentro_id;
END;
$function$;
