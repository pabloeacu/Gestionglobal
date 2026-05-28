-- ============================================================================
-- Migration: 0094_derivar_auto_linea
-- Fecha: 2026-05-27
-- DGG-XX · Fix #146: al derivar a gestoría se agrega línea automática en tracking
--
-- Pedido del usuario: cuando una solicitud se deriva a un gestor externo, debe
-- generarse automáticamente una línea de avance en el trámite (si existe)
-- con el texto "Envío a sector de gestoría — <destinatario>", visible al
-- cliente, categoría 'tramite_enviado'. Esto cierra el ciclo solicitud→avance
-- y el cliente ve la novedad en su portal sin acción manual del staff.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.solicitud_derivar(
  p_solicitud_id        uuid,
  p_destinatario_email  text,
  p_destinatario_nombre text,
  p_plantilla_slug      text DEFAULT 'solicitud-derivada-gestoria',
  p_observaciones       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_token   text;
  v_url     text;
  v_email_id uuid;
  v_der_id  uuid;
  v_vars    jsonb;
  v_destinatario_label text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_servicio_nombre := COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio');

  BEGIN
    EXECUTE 'SELECT public.generar_acceso_externo($1,$2,$3,$4)'
      INTO v_token
      USING 'solicitud', p_solicitud_id, p_destinatario_email, 7;
    v_url := 'https://gestionglobal.ar/acceso/' || v_token;
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
    v_url   := 'https://gestionglobal.ar/acceso/pendiente?solicitud=' || p_solicitud_id::text;
  END;

  v_vars := jsonb_build_object(
    'destinatario_nombre', COALESCE(p_destinatario_nombre, split_part(p_destinatario_email,'@',1)),
    'servicio',            v_servicio_nombre,
    'solicitante_nombre',  COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',   COALESCE(v_sol.solicitante_email, ''),
    'observaciones',       COALESCE(p_observaciones, ''),
    'acceso_url',          v_url
  );

  BEGIN
    v_email_id := public.encolar_email(
      p_plantilla_slug, p_destinatario_email, p_destinatario_nombre,
      v_vars, NULL, NULL, 'solicitudes', p_solicitud_id, 3::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    v_email_id := NULL;
  END;

  INSERT INTO public.solicitud_derivaciones (
    solicitud_id, destinatario_email, destinatario_nombre,
    plantilla_email_slug, observaciones,
    acceso_externo_token, acceso_externo_url,
    email_queue_id, creada_por
  )
  VALUES (
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones,
    v_token, v_url, v_email_id, auth.uid()
  )
  RETURNING id INTO v_der_id;

  UPDATE public.solicitudes
     SET estado = 'derivada',
         derivada_at = COALESCE(derivada_at, now()),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  -- ===== NUEVO: línea de avance automática en el tracking =====
  -- Si la solicitud tiene tramite_id (vinculado al activarse), agregar línea
  -- visible al cliente con categoría 'tramite_enviado'. El trigger
  -- tracking_linea_on_insert se encargará de email + push + notif interna.
  IF v_sol.tramite_id IS NOT NULL THEN
    v_destinatario_label := COALESCE(NULLIF(p_destinatario_nombre, ''), p_destinatario_email);

    INSERT INTO public.tracking_lineas (
      tramite_id, categoria, descripcion, archivos_urls,
      autor_id, visible_cliente
    ) VALUES (
      v_sol.tramite_id,
      'tramite_enviado',
      'Envío a sector de gestoría — destinatario: ' || v_destinatario_label
        || CASE WHEN COALESCE(p_observaciones, '') <> ''
                THEN E'\n\nObservaciones: ' || p_observaciones
                ELSE '' END,
      '{}'::text[],
      auth.uid(),
      true   -- visible al cliente: ve que su trámite avanzó a gestoría
    );
  END IF;

  RETURN v_der_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitud_derivar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_derivar(uuid, text, text, text, text) TO authenticated;
