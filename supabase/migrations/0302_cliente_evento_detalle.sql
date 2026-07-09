-- 0302 · Etapa A (Pablo): ficha del evento en el portal del cliente.
-- El cliente se inscribe con un click, pero antes necesita ver la info completa
-- del evento (dónde es, mapa, flyer, disertantes, arancel). RPC read-only que
-- devuelve la info PÚBLICA del evento + el estado de inscripción del cliente.
--
-- Seguridad: SECURITY DEFINER, deriva la administración del contexto (no recibe
-- p_administracion_id → no necesita assert_administracion_access, R12). Sólo
-- expone campos públicos (NUNCA zoom_start_url/password: se arma el jsonb a mano,
-- no con to_jsonb del row). Visible si el evento está publicado o el cliente ya
-- está inscripto. anon revocado desde el arranque (E-GG-94: no repetir el
-- over-grant; toda función nueva pre-0130 hereda EXECUTE de PUBLIC).
CREATE OR REPLACE FUNCTION public.cliente_evento_detalle(p_webinar_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_web public.webinars%ROWTYPE;
  v_insc record;
  v_inscripto boolean;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_administracion_context');
  END IF;

  SELECT * INTO v_web FROM public.webinars WHERE id = p_webinar_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- Estado de inscripción del cliente (la más reciente si hubiera varias del
  -- mismo cliente/administración). LIMIT 1 evita multi-row en el INTO.
  SELECT wi.canal, wi.asistio
    INTO v_insc
    FROM public.webinar_inscriptos wi
   WHERE wi.webinar_id = p_webinar_id
     AND wi.administracion_id = v_admin_id
   ORDER BY wi.inscripto_at DESC
   LIMIT 1;
  v_inscripto := FOUND;

  -- Visibilidad: publicado (para decidir inscribirse) o ya inscripto.
  IF NOT v_web.publicado AND NOT v_inscripto THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'id', v_web.id,
    'titulo', v_web.titulo,
    'descripcion', v_web.descripcion,
    'banner_url', v_web.banner_url,
    'flyer_url', v_web.flyer_url,
    'docentes', v_web.docentes,
    'fecha_hora', v_web.fecha_hora,
    'duracion_min', v_web.duracion_min,
    'plataforma', v_web.plataforma,
    'modalidad', v_web.modalidad,
    'tipo', v_web.tipo,
    'status', v_web.status,
    'ubicacion_lugar', v_web.ubicacion_lugar,
    'ubicacion_direccion', v_web.ubicacion_direccion,
    'ubicacion_localidad', v_web.ubicacion_localidad,
    'ubicacion_mapa_url', v_web.ubicacion_mapa_url,
    'ubicacion_instrucciones', v_web.ubicacion_instrucciones,
    'es_arancelado', v_web.es_arancelado,
    'arancel_monto', v_web.arancel_monto,
    'arancel_nota', v_web.arancel_nota,
    'grabacion_url', v_web.grabacion_url,
    'inscripto', v_inscripto,
    'canal', CASE WHEN v_inscripto THEN v_insc.canal ELSE NULL END,
    'asistio', CASE WHEN v_inscripto THEN COALESCE(v_insc.asistio, false) ELSE false END,
    'join_url', CASE WHEN v_inscripto
                     THEN COALESCE(v_web.zoom_join_url, v_web.webex_join_url, v_web.youtube_live_url)
                     ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cliente_evento_detalle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_evento_detalle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cliente_evento_detalle(uuid) TO authenticated;
