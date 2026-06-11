-- Pedido de Pablo: el mail de "pedir un nuevo enlace" (estado de error del acceso
-- externo) debe llevar los datos del cliente y el trámite. En ese estado el token
-- está vencido/revocado, así que no hay payload del edge function. RPC pública
-- mínima que, dado el token (aunque esté vencido), resuelve SÓLO identificadores
-- no sensibles (cliente, código de trámite, servicio) para pre-armar el mail.
-- SECURITY DEFINER (bypassa la RLS staff-only de accesos_externos); quien tiene el
-- token ya tenía acceso al recurso. No expone columnas sensibles.
CREATE OR REPLACE FUNCTION public.gestor_acceso_ref(p_token text)
RETURNS TABLE(cliente_nombre text, tramite_codigo text, servicio_nombre text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.nombre,
         t.codigo,
         COALESCE(srv.nombre, t.titulo)
  FROM public.accesos_externos ae
  JOIN public.solicitudes s ON s.id = ae.recurso_id AND ae.recurso_tipo = 'solicitud'
  LEFT JOIN public.tramites t ON t.id = s.tramite_id
  LEFT JOIN public.administraciones a ON a.id = COALESCE(t.administracion_id, s.cliente_id)
  LEFT JOIN public.servicios srv ON srv.id = t.servicio_id
  WHERE ae.token = p_token;
$function$;
REVOKE EXECUTE ON FUNCTION public.gestor_acceso_ref(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gestor_acceso_ref(text) TO anon, authenticated;
