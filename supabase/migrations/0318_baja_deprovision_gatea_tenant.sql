-- 0318 · Blindaje de baja/deprovision (Gap 1, auditoría §6 pre-lanzamiento).
-- HALLAZGO: un cliente dado de baja SEGUÍA pudiendo loguearse y ver TODO su
-- portal. Ninguna capa (login, guard de ruta, RLS) miraba activo/estado. Las 16
-- tablas del cliente cuelgan de private.current_administracion_id(), que
-- devolvía el tenant sin gatear por estado. Verificado e2e por 2 análisis
-- independientes. Fix de raíz: gatear el helper (una línea blinda las 16
-- policies + assert_administracion_access de golpe).

-- (1) Helper gateado. NULL si la admin o el profile no están activos → toda
--     policy de cliente devuelve 0 filas y assert_administracion_access rechaza.
--     Staff bypassa vía is_staff() y no usa este helper. Misma firma → R16.
--     SECURITY DEFINER ⇒ el SELECT interno a administraciones NO dispara su RLS
--     (sin recursión). coalesce(estado,'') evita bloquear por estado NULL.
CREATE OR REPLACE FUNCTION private.current_administracion_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.administracion_id
  FROM public.profiles p
  JOIN public.administraciones a ON a.id = p.administracion_id
  WHERE p.id = auth.uid()
    AND p.activo = true
    AND a.activo = true
    AND coalesce(a.estado,'') <> 'baja';
$function$;

-- (2) Baja transaccional (R5: toca administraciones + profiles). Marca la admin
--     de baja + deshabilita sus usuarios de portal (administradores). El front,
--     al ver profile.activo=false, hace signOut con mensaje claro.
CREATE OR REPLACE FUNCTION public.administracion_dar_de_baja(p_administracion_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede dar de baja un cliente'; END IF;
  UPDATE public.administraciones SET estado='baja', activo=false WHERE id=p_administracion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  UPDATE public.profiles SET activo=false
   WHERE administracion_id=p_administracion_id AND role='administrador';
END;
$function$;

-- (3) Reactivar: revierte la baja + rehabilita los usuarios de portal.
CREATE OR REPLACE FUNCTION public.administracion_reactivar(p_administracion_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede reactivar un cliente'; END IF;
  UPDATE public.administraciones SET estado='activo', activo=true WHERE id=p_administracion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  UPDATE public.profiles SET activo=true
   WHERE administracion_id=p_administracion_id AND role='administrador';
END;
$function$;

REVOKE ALL ON FUNCTION public.administracion_dar_de_baja(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.administracion_reactivar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.administracion_dar_de_baja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.administracion_reactivar(uuid) TO authenticated;
