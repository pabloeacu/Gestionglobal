-- DGG-97 (reporte JL) · En el detalle de una solicitud, la textarea "Observaciones
-- internas" no tenía forma de guardarse sola: la nota SÓLO se persistía como efecto
-- lateral de "Marcar en revisión" (solicitud_marcar_en_revision). Un gerente que quería
-- dejar una nota en una solicitud RECIBIDA sin cambiarla de estado no podía → "no me
-- deja guardar". (E-GG-85)
--
-- RPC dedicada: guarda SÓLO las observaciones, sin tocar el estado. Staff-only.
CREATE OR REPLACE FUNCTION public.solicitud_guardar_observaciones(
  p_solicitud_id uuid,
  p_observaciones text DEFAULT NULL
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.solicitudes
     SET observaciones = NULLIF(btrim(p_observaciones), '')
   WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.solicitud_guardar_observaciones(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitud_guardar_observaciones(uuid, text) TO authenticated;
