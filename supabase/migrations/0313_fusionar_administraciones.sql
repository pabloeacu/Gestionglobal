-- 0313 · Reporte JL (herramienta para consolidar duplicados) · RPC de fusión de
-- administraciones. Reasigna TODOS los datos (comprobantes, movimientos, trámites,
-- solicitudes, certificados, inscripciones, matrículas, consorcios, vencimientos,
-- recupero, submissions, mails, prospecto convertido) del ORIGEN al DESTINO, deja
-- la config inerte en el origen (no tiene datos de negocio), y marca el origen
-- inactivo + renombrado. Ninguna FK a administraciones tiene UNIQUE sobre
-- administracion_id (los únicos son por profile_id/email_snapshot) → reasignar es
-- seguro. Staff-only. Devuelve un resumen jsonb de lo movido.
--
-- NO fusiona automáticamente nada: es una herramienta que la gerencia dispara a
-- mano cuando confirma que dos administraciones son la misma persona.
CREATE OR REPLACE FUNCTION public.fusionar_administraciones(p_origen uuid, p_destino uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dest_nombre text;
  v_orig_nombre text;
  v_res jsonb := '{}'::jsonb;
  v_n int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede fusionar administraciones' USING ERRCODE = '42501';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Origen y destino deben ser distintos y no nulos' USING ERRCODE = '22023';
  END IF;
  SELECT nombre INTO v_dest_nombre FROM public.administraciones WHERE id = p_destino;
  IF v_dest_nombre IS NULL THEN RAISE EXCEPTION 'Destino inexistente' USING ERRCODE = 'P0002'; END IF;
  SELECT nombre INTO v_orig_nombre FROM public.administraciones WHERE id = p_origen;
  IF v_orig_nombre IS NULL THEN RAISE EXCEPTION 'Origen inexistente' USING ERRCODE = 'P0002'; END IF;

  -- Reasignación de datos (helper inline por tabla, sumando el resumen).
  UPDATE public.comprobantes            SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comprobantes',v_n);
  UPDATE public.movimientos             SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('movimientos',v_n);
  UPDATE public.movimiento_imputaciones SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('imputaciones',v_n);
  UPDATE public.tramites                SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('tramites',v_n);
  UPDATE public.solicitudes             SET cliente_id=p_destino       WHERE cliente_id=p_origen;         GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('solicitudes',v_n);
  UPDATE public.certificados            SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('certificados',v_n);
  UPDATE public.curso_matriculas        SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('matriculas',v_n);
  UPDATE public.webinar_inscriptos      SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('inscriptos',v_n);
  UPDATE public.consorcios              SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('consorcios',v_n);
  UPDATE public.formulario_submissions  SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('submissions',v_n);
  UPDATE public.vencimientos            SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('vencimientos',v_n);
  UPDATE public.recupero_acciones       SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('recupero_acciones',v_n);
  UPDATE public.cliente_oportunidad_eventos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('oportunidad_eventos',v_n);
  UPDATE public.comunicaciones_destinatarios SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comunicaciones',v_n);
  UPDATE public.sent_emails             SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('sent_emails',v_n);
  UPDATE public.email_queue             SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('email_queue',v_n);
  UPDATE public.administracion_emails   SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('emails_extra',v_n);
  UPDATE public.prospectos              SET convertido_a_administracion_id=p_destino WHERE convertido_a_administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('prospectos',v_n);

  -- Origen fuera de circulación (config queda inerte con él).
  UPDATE public.administraciones
     SET activo = false,
         estado = 'baja',
         nombre = v_orig_nombre || ' [fusionado → ' || v_dest_nombre || ']',
         updated_at = now()
   WHERE id = p_origen;

  RETURN jsonb_build_object('ok', true, 'origen', p_origen, 'destino', p_destino, 'movido', v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.fusionar_administraciones(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fusionar_administraciones(uuid, uuid) TO authenticated;
