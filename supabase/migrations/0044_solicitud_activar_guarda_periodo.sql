-- 0044 · Bug QA · solicitud_activar no guardaba periodo/fecha_inicio/servicio_id/
-- parent_tracking_id en la fila `tramites` (sólo los pasaba a
-- tracking_agregar_linea, envuelto en EXCEPTION...NULL que tragaba errores).
-- Resultado: el detalle del tracking mostraba Período "—" y el acceso externo
-- periodo:null. Fix: setear esas columnas directo en el INSERT INTO tramites.
--
-- (El cuerpo completo del RPC se recrea; el único cambio respecto del original
-- es el bloque INSERT INTO public.tramites, que ahora incluye servicio_id,
-- periodo, fecha_inicio y parent_tracking_id.)
CREATE OR REPLACE FUNCTION public.solicitud_activar(
  p_solicitud_id uuid, p_cliente_id uuid DEFAULT NULL::uuid,
  p_crear_cliente_input jsonb DEFAULT NULL::jsonb, p_periodo text DEFAULT NULL::text,
  p_fecha_inicio date DEFAULT NULL::date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_cliente uuid;
  v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid;
  v_categoria text;
  v_titulo text;
  v_parent_tramite uuid;
  v_email_admin text;
  v_admin_nombre text;
  v_es_nuevo boolean := false;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.estado = 'activada' THEN
    RAISE EXCEPTION 'La solicitud ya está activada' USING ERRCODE = '22023';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    v_cliente := p_cliente_id;
    SELECT email, nombre INTO v_email_admin, v_admin_nombre
      FROM public.administraciones WHERE id = v_cliente;
  ELSIF p_crear_cliente_input IS NOT NULL THEN
    v_es_nuevo := true;
    INSERT INTO public.administraciones (
      codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
      localidad, provincia, codigo_postal, observaciones, estado, activo
    )
    VALUES (
      COALESCE(p_crear_cliente_input->>'codigo', 'AUTO-' || substring(p_solicitud_id::text,1,8)),
      COALESCE(p_crear_cliente_input->>'nombre', v_sol.solicitante_nombre, 'Cliente sin nombre'),
      '',
      NULLIF(p_crear_cliente_input->>'cuit',''),
      COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email),
      COALESCE(NULLIF(p_crear_cliente_input->>'telefono',''), v_sol.solicitante_telefono),
      NULLIF(p_crear_cliente_input->>'direccion',''),
      NULLIF(p_crear_cliente_input->>'localidad',''),
      NULLIF(p_crear_cliente_input->>'provincia',''),
      NULLIF(p_crear_cliente_input->>'codigo_postal',''),
      NULLIF(p_crear_cliente_input->>'observaciones',''),
      'activo', true
    )
    RETURNING id, email, nombre INTO v_cliente, v_email_admin, v_admin_nombre;
  ELSE
    v_cliente := v_sol.cliente_id;
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT * INTO v_servicio FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;

  v_categoria := CASE COALESCE(v_sol.servicio_slug,'')
    WHEN 'matriculacion-rpac'    THEN 'matricula'
    WHEN 'renovacion-rpac'       THEN 'renovacion'
    WHEN 'certificado-rpac'      THEN 'matricula'
    WHEN 'ddjj-anual'            THEN 'dj'
    WHEN 'consultoria-juridica'  THEN 'consulta_juridica'
    WHEN 'curso-formacion'       THEN 'curso'
    WHEN 'curso-actualizacion'   THEN 'curso'
    ELSE 'otro'
  END;

  v_titulo := COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio')
            || ' · '
            || COALESCE(v_sol.solicitante_nombre, v_admin_nombre, v_sol.solicitante_email, 'sin contacto');

  IF v_cliente IS NOT NULL AND v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT t.id INTO v_parent_tramite
      FROM public.tramites t
     WHERE t.administracion_id = v_cliente
       AND t.categoria = v_categoria
     ORDER BY t.created_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_id, periodo, fecha_inicio, parent_tracking_id,
    created_by
  )
  VALUES (
    v_titulo,
    'Tracking activado desde solicitud ' || p_solicitud_id::text
      || COALESCE(' · período ' || p_periodo, '')
      || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    v_categoria, 'normal', 'abierto',
    v_sol.formulario_submission_id, v_cliente,
    v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono,
    v_sol.servicio_solicitado_id, p_periodo, p_fecha_inicio, v_parent_tramite,
    auth.uid()
  )
  RETURNING id INTO v_tramite_id;

  BEGIN
    EXECUTE 'SELECT public.tracking_agregar_linea($1,$2,$3,$4,$5)'
      USING v_tramite_id,
            v_sol.servicio_solicitado_id,
            p_periodo,
            p_fecha_inicio,
            v_parent_tramite;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    UPDATE public.formulario_submissions
       SET estado = 'procesado',
           procesado_at = now(),
           procesado_por = auth.uid()
     WHERE id = v_sol.formulario_submission_id
       AND estado <> 'procesado';
  END IF;

  IF v_cliente IS NOT NULL AND v_email_admin IS NOT NULL AND v_email_admin <> '' THEN
    BEGIN
      IF v_es_nuevo THEN
        PERFORM public.encolar_email(
          'bienvenida-administracion', v_email_admin, v_admin_nombre,
          jsonb_build_object('nombre_administracion', v_admin_nombre, 'email_user', v_email_admin),
          v_cliente, NULL, 'administraciones', v_cliente, 3::smallint
        );
      ELSE
        PERFORM public.encolar_email(
          'nuevo-servicio-activado', v_email_admin, v_admin_nombre,
          jsonb_build_object('nombre', v_admin_nombre,
            'servicio', COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio'),
            'link_portal', 'https://gestionglobal.ar/portal'),
          v_cliente, NULL, 'tramites', v_tramite_id, 3::smallint
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  UPDATE public.solicitudes
     SET estado     = 'activada',
         tramite_id = v_tramite_id,
         cliente_id = v_cliente,
         activada_at = now(),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  RETURN v_tramite_id;
END;
$function$;
