-- 0299 · Fix §6 (Agente C, #2): la card "Otros próximos eventos" del portal
-- (WebinarAvailCard) mostraba "GRATUITO" hardcodeado. Un evento ARANCELADO se
-- anunciaba como gratis al cliente. La RPC no traía el arancel en `disponibles`.
-- Se agrega es_arancelado + arancel_monto SÓLO a `disponibles` (el front condiciona
-- el kicker). Misma firma 0-args → CREATE OR REPLACE (sin overload, R16). Resto
-- del cuerpo idéntico a 0050/…: mis_webinars no cambia (usa badges por status).
CREATE OR REPLACE FUNCTION public.cliente_webinars_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_mis_inscriptos jsonb;
  v_disponibles jsonb;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'webinar_id', w.id,
    'titulo', w.titulo,
    'descripcion', w.descripcion,
    'fecha_hora', w.fecha_hora,
    'duracion_min', w.duracion_min,
    'status', w.status,
    'plataforma', w.plataforma,
    'link', COALESCE(w.zoom_join_url, w.webex_join_url, w.youtube_live_url),
    'grabacion_url', w.grabacion_url,
    'inscripto_at', wi.inscripto_at,
    'asistio', wi.asistio
  ) ORDER BY w.fecha_hora DESC), '[]'::jsonb)
  INTO v_mis_inscriptos
  FROM public.webinar_inscriptos wi
  JOIN public.webinars w ON w.id = wi.webinar_id
  WHERE wi.administracion_id = v_admin_id
    AND (
      w.fecha_hora >= now() - interval '30 days'
      OR w.status IN ('programado','en_curso')
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'webinar_id', w.id,
    'titulo', w.titulo,
    'descripcion', w.descripcion,
    'fecha_hora', w.fecha_hora,
    'duracion_min', w.duracion_min,
    'plataforma', w.plataforma,
    'es_arancelado', w.es_arancelado,
    'arancel_monto', w.arancel_monto
  ) ORDER BY w.fecha_hora ASC), '[]'::jsonb)
  INTO v_disponibles
  FROM public.webinars w
  WHERE w.status = 'programado'
    AND w.fecha_hora >= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.webinar_inscriptos wi
      WHERE wi.webinar_id = w.id AND wi.administracion_id = v_admin_id
    );

  RETURN jsonb_build_object(
    'mis_webinars', v_mis_inscriptos,
    'disponibles', v_disponibles
  );
END;
$function$;
