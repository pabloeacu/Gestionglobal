-- ============================================================================
-- 0396 · DGG-122 · Hardening §6 post-auditoría de la Fase 1 gestoría
--
-- 1) REVOKE de PUBLIC en gestoria_set_adjunto_visible: CREATE FUNCTION regala
--    EXECUTE a PUBLIC por default y el REVOKE FROM anon de 0395 no alcanzaba
--    (anon heredaba por PUBLIC). El guard is_staff() ya contenía, pero la ACL
--    debe decir la verdad (defensa en profundidad).
-- 2) solicitud_derivar_v2: el subject de email_queue quedaba con las llaves
--    crudas '{{solicitante_nombre}}: {{servicio}}' (el dispatcher lo ignora y
--    renderiza la plantilla, pero la UI de la cola muestra/busca por subject).
--    Ahora se encola RENDERIZADO, igual que el re-aviso. Firma idéntica (R16).
-- ============================================================================

REVOKE ALL ON FUNCTION public.gestoria_set_adjunto_visible(text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gestoria_set_adjunto_visible(text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.gestoria_set_adjunto_visible(text, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.solicitud_derivar_v2(
  p_solicitud_id uuid, p_destinatario_email text, p_destinatario_nombre text,
  p_plantilla_slug text DEFAULT 'solicitud-derivada-gestoria'::text,
  p_observaciones text DEFAULT NULL::text, p_dias_validez integer DEFAULT 14,
  p_monto_pago numeric DEFAULT NULL::numeric, p_adjuntos jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol      public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_token    text;
  v_url      text;
  v_email_id uuid;
  v_der_id   uuid;
  v_vars     jsonb;
  v_dst_lbl  text;
  v_dias     int;
  v_tpl      public.email_templates%ROWTYPE;
  v_documentos text;
  v_subject  text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  v_dias := COALESCE(p_dias_validez, 14);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango (1..365)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_servicio_nombre := COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio');

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    SELECT string_agg(
             '— ' || private.form_field_label(f.schema, fa.field_name)
                  || ': ' || fa.filename_original,
             E'\n' ORDER BY fa.uploaded_at
           )
      INTO v_documentos
      FROM public.formulario_adjuntos fa
      JOIN public.formulario_submissions fs ON fs.id = fa.submission_id
      JOIN public.formularios f ON f.id = fs.formulario_id
     WHERE fa.submission_id = v_sol.formulario_submission_id
       AND fa.visible_gestoria;                         -- DGG-122
  END IF;
  v_documentos := CASE
    WHEN COALESCE(v_documentos, '') = '' THEN ''
    ELSE 'Documentación del cliente recibida:' || E'\n' || v_documentos
  END;

  BEGIN
    v_token := public.generar_acceso_externo(
      'solicitud'::text, p_solicitud_id, p_destinatario_email,
      p_destinatario_nombre, v_dias, NULL::text
    );
    v_url := 'https://gestionglobal.ar/externo/' || v_token;
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
    v_url   := 'https://gestionglobal.ar/externo/pendiente?solicitud=' || p_solicitud_id::text;
  END;

  v_vars := jsonb_build_object(
    'destinatario_nombre', COALESCE(p_destinatario_nombre, split_part(p_destinatario_email,'@',1)),
    'servicio',            v_servicio_nombre,
    'solicitante_nombre',  COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',   COALESCE(v_sol.solicitante_email, ''),
    'observaciones',       COALESCE(p_observaciones, ''),
    'acceso_url',          v_url,
    'dias_validez',        v_dias::text,
    'monto_pago_gestoria', COALESCE(p_monto_pago::text, ''),
    'adjuntos_count',      (jsonb_array_length(COALESCE(p_adjuntos,'[]'::jsonb)))::text,
    'documentos',          v_documentos
  );

  -- §6 0396: subject RENDERIZADO en la cola (el mail real siempre sale de la
  -- plantilla; esto es coherencia para la UI/búsqueda de la cola de emails).
  v_subject := COALESCE(NULLIF(v_sol.solicitante_nombre, ''), 'Cliente')
               || ': ' || v_servicio_nombre;

  SELECT * INTO v_tpl FROM public.email_templates WHERE slug = p_plantilla_slug LIMIT 1;
  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables,
    attachments_jsonb, prioridad, programado_para, related_table, related_id
  ) VALUES (
    p_destinatario_email,
    p_destinatario_nombre,
    v_subject,
    'workflow',
    p_plantilla_slug,
    v_vars,
    COALESCE(p_adjuntos, '[]'::jsonb),
    3,
    now(),
    'solicitudes',
    p_solicitud_id
  ) RETURNING id INTO v_email_id;

  INSERT INTO public.solicitud_derivaciones (
    solicitud_id, destinatario_email, destinatario_nombre,
    plantilla_email_slug, observaciones,
    acceso_externo_token, acceso_externo_url,
    email_queue_id, creada_por,
    monto_pago_gestoria, adjuntos_jsonb
  ) VALUES (
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones,
    v_token, v_url, v_email_id, auth.uid(),
    p_monto_pago, COALESCE(p_adjuntos, '[]'::jsonb)
  ) RETURNING id INTO v_der_id;

  UPDATE public.solicitudes
     SET estado = 'derivada',
         derivada_at = COALESCE(derivada_at, now()),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  IF v_sol.tramite_id IS NOT NULL THEN
    v_dst_lbl := COALESCE(NULLIF(p_destinatario_nombre, ''), p_destinatario_email);
    INSERT INTO public.tracking_lineas (
      tramite_id, categoria, descripcion, archivos_urls,
      autor_id, visible_cliente, alerta_en
    ) VALUES (
      v_sol.tramite_id, 'tramite_enviado',
      'Envío a sector de gestoría — destinatario: ' || v_dst_lbl
        || CASE WHEN COALESCE(p_observaciones, '') <> ''
                THEN E'\n\nObservaciones: ' || p_observaciones
                ELSE '' END
        || CASE WHEN jsonb_array_length(COALESCE(p_adjuntos,'[]'::jsonb)) > 0
                THEN E'\n\nAdjuntos: ' || jsonb_array_length(COALESCE(p_adjuntos,'[]'::jsonb))::text
                ELSE '' END,
      '{}'::text[], auth.uid(), false,
      private.dias_habiles_add(now(), 5)
    );
  END IF;

  RETURN v_der_id;
END;
$function$;
