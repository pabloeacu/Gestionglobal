-- DGG-96 (reporte JL) · El portal del cliente mostraba "1 nuevo avance en tus gestiones"
-- aunque TODAS las gestiones estuvieran cerradas/resueltas. Causa: el contador contaba
-- avances no-leídos SIN filtrar por estado del trámite → el avance automático de cierre
-- ("Tu trámite fue resuelto.") quedaba como "novedad" para siempre (el cliente no reabre
-- trámites cerrados, así que nunca se marca leído). (E-GG-84)
--
-- (1) El contador excluye trámites en estado terminal (cerrado/resuelto/cancelado): un
--     cliente sin nada activo deja de ver el enganche. La notif sigue en la campanita.
CREATE OR REPLACE FUNCTION public.cliente_tracking_avances_nuevos_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COUNT(*)::int
  FROM (
    SELECT (n.payload->>'tramite_id')::uuid AS tramite_id
    FROM public.notificaciones_internas n
    WHERE n.user_id = auth.uid()
      AND n.tipo = 'tracking_avance'
      AND n.leido_at IS NULL
      AND n.archivado_at IS NULL
      AND n.payload ? 'tramite_id'
  ) x
  JOIN public.tramites t ON t.id = x.tramite_id
  WHERE t.estado NOT IN ('cerrado', 'resuelto', 'cancelado');
$function$;

-- (2) Bug lateral (R15): la url de la notif/email apuntaba a /portal/mis-gestiones/<id>,
--     ruta que NO existe (la real es /portal/gestiones/:id) → el click caía en ruta muerta.
--     Corregido en la función emisora (afecta notifs futuras).
CREATE OR REPLACE FUNCTION private.tracking_notificar_avance_cliente(p_linea_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE; v_tramite record; v_svc text;
  v_to_email text; v_to_nombre text; v_admin_user_id uuid; v_portal_url text;
BEGIN
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN RETURN; END IF;
  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t LEFT JOIN public.servicios s ON s.id = t.servicio_id WHERE t.id = v_linea.tramite_id;
  v_svc := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_to_email := v_tramite.solicitante_email; v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  v_portal_url := 'https://www.gestionglobal.ar/portal/gestiones/' || v_linea.tramite_id::text;
  IF v_to_email IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_email('tracking-avance-cliente', v_to_email, v_to_nombre,
        jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_svc, 'descripcion', v_linea.descripcion, 'portal_url', v_portal_url),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', v_linea.id, 3::smallint);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_admin_user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_svc, substring(v_linea.descripcion, 1, 140), NULL, v_portal_url);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance', 'Nuevo avance: ' || v_svc,
        substring(v_linea.descripcion, 1, 200), '/portal/gestiones/' || v_linea.tramite_id::text,
        jsonb_build_object('tramite_id', v_linea.tramite_id, 'linea_id', v_linea.id, 'servicio', v_svc));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$function$;

-- (3) Backfill: corregir la url de las notifs existentes a la ruta real.
UPDATE public.notificaciones_internas
   SET url = replace(url, '/portal/mis-gestiones/', '/portal/gestiones/')
 WHERE url LIKE '/portal/mis-gestiones/%';
