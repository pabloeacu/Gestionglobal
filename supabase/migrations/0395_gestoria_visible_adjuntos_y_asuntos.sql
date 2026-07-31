-- ============================================================================
-- 0395 · DGG-122 (Fase 1 gestoría · pedido JL/Pablo 31/07)
--
-- 1) visible_gestoria en adjuntos del formulario Y en items de pedidos de doc
--    (default TRUE = comportamiento actual intacto; nada se borra ni se altera
--    para gerencia/cliente — SOLO las superficies del gestor filtran).
-- 2) RPC staff-only para togglear el flag (las tablas no tienen policy UPDATE
--    y así queda auditable en un solo lugar).
-- 3) Filtros en las 3 salidas hacia gestoría: RPC del panel, lista de
--    documentos del mail de derivación, y (en la edge fn, deploy aparte) la
--    firma de URLs. R16: TODAS las RPCs se reemplazan con firma idéntica.
-- 4) Asuntos de los mails a gestoría: "{{solicitante_nombre}}: {{servicio}}"
--    (pedido explícito: aplica a derivación Y re-avisos). El re-aviso gana las
--    variables solicitante_nombre y servicio que no inyectaba.
-- ============================================================================

-- ── 1 · Columnas (aditivas, default true → cero cambio de comportamiento) ──
ALTER TABLE public.formulario_adjuntos
  ADD COLUMN visible_gestoria boolean NOT NULL DEFAULT true;
ALTER TABLE public.tramite_pedidos_doc_items
  ADD COLUMN visible_gestoria boolean NOT NULL DEFAULT true;

-- ── 2 · Toggle staff-only (R5/R12: sin policy UPDATE en las tablas) ──
CREATE FUNCTION public.gestoria_set_adjunto_visible(
  p_origen text,      -- 'form' | 'pedido'
  p_id uuid,
  p_visible boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_origen = 'form' THEN
    UPDATE public.formulario_adjuntos SET visible_gestoria = p_visible WHERE id = p_id;
  ELSIF p_origen = 'pedido' THEN
    UPDATE public.tramite_pedidos_doc_items SET visible_gestoria = p_visible WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'origen inválido: %', p_origen USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjunto no encontrado' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.gestoria_set_adjunto_visible(text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.gestoria_set_adjunto_visible(text, uuid, boolean) TO authenticated;

-- ── 3a · Panel del gestor: filtrar ocultos (firma idéntica a 0335) ──
CREATE OR REPLACE FUNCTION public.gestor_obtener_info_solicitud(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_datos jsonb;
  v_form_titulo text;
  v_form_categoria text;
  v_form_schema jsonb;
  v_adjuntos jsonb;
  v_pedidos_doc jsonb;
BEGIN
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.revocado_at IS NOT NULL OR v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Token revocado o vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo NOT IN ('solicitud','tramite') THEN
    RAISE EXCEPTION 'Token no asociado a una solicitud' USING ERRCODE = '22023';
  END IF;

  IF v_acc.recurso_tipo = 'solicitud' THEN
    SELECT * INTO v_sol FROM public.solicitudes WHERE id = v_acc.recurso_id;
  ELSE
    SELECT * INTO v_sol FROM public.solicitudes WHERE tramite_id = v_acc.recurso_id LIMIT 1;
  END IF;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    SELECT fs.datos, f.titulo, f.categoria, f.schema
      INTO v_datos, v_form_titulo, v_form_categoria, v_form_schema
      FROM public.formulario_submissions fs
      JOIN public.formularios f ON f.id = fs.formulario_id
     WHERE fs.id = v_sol.formulario_submission_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'field_name', fa.field_name,
        'label', private.form_field_label(v_form_schema, fa.field_name),
        'filename_original', fa.filename_original,
        'storage_path', fa.storage_path
      ) ORDER BY fa.uploaded_at), '[]'::jsonb)
      INTO v_adjuntos
      FROM public.formulario_adjuntos fa
      WHERE fa.submission_id = v_sol.formulario_submission_id
        AND fa.visible_gestoria;                        -- DGG-122
  ELSE
    v_datos := '{}'::jsonb;
    v_adjuntos := '[]'::jsonb;
  END IF;

  IF v_sol.tramite_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'descripcion', it.descripcion,
        'filename_original', COALESCE(it.archivo_nombre, 'archivo'),
        'storage_path', it.archivo_path,
        'respuesta_texto', it.respuesta_texto,
        'estado', it.estado,
        'subido_at', it.subido_at
      ) ORDER BY it.subido_at NULLS LAST), '[]'::jsonb)
      INTO v_pedidos_doc
      FROM public.tramite_pedidos_doc pd
      JOIN public.tramite_pedidos_doc_items it ON it.pedido_id = pd.id
     WHERE pd.tramite_id = v_sol.tramite_id
       AND (it.archivo_path IS NOT NULL OR it.respuesta_texto IS NOT NULL)
       AND it.estado IN ('subido','aprobado')
       AND it.visible_gestoria;                         -- DGG-122
  ELSE
    v_pedidos_doc := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'solicitud_id', v_sol.id,
    'servicio',           COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio'),
    'solicitante_nombre', COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',  COALESCE(v_sol.solicitante_email, ''),
    'solicitante_telefono', COALESCE(v_sol.solicitante_telefono, ''),
    'formulario_titulo',  v_form_titulo,
    'formulario_categoria', v_form_categoria,
    'datos',              COALESCE(v_datos, '{}'::jsonb),
    'adjuntos',           v_adjuntos,
    'pedidos_doc',        COALESCE(v_pedidos_doc, '[]'::jsonb),
    'created_at',         v_sol.created_at
  );
END;
$function$;

-- ── 3b · Mail de derivación: la lista de documentos omite ocultos ──
--        (firma idéntica a 0208; solo cambia el WHERE de v_documentos)
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

  SELECT * INTO v_tpl FROM public.email_templates WHERE slug = p_plantilla_slug LIMIT 1;
  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables,
    attachments_jsonb, prioridad, programado_para, related_table, related_id
  ) VALUES (
    p_destinatario_email,
    p_destinatario_nombre,
    COALESCE(v_tpl.asunto, 'Solicitud derivada'),
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

-- ── 3c · Re-aviso: gana las vars solicitante_nombre + servicio (firma idéntica) ──
CREATE OR REPLACE FUNCTION public.derivacion_reavisar_gestoria(p_tramite_id uuid, p_mensaje text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_deriv public.solicitud_derivaciones%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_vence timestamptz; v_revocado timestamptz;
  v_token text; v_url text; v_mensaje text;
  v_servicio text;
  v_solicitante text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe'; END IF;
  IF v_tramite.estado IN ('cerrado','cancelado') THEN
    RAISE EXCEPTION 'El trámite está % — no se puede reavisar a la gestoría ni reabrir su acceso.', v_tramite.estado
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT d.* INTO v_deriv
    FROM public.solicitud_derivaciones d
    JOIN public.solicitudes s ON s.id = d.solicitud_id
   WHERE s.tramite_id = p_tramite_id
   ORDER BY d.enviada_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este trámite no fue derivado a una gestoría' USING ERRCODE = 'P0002';
  END IF;

  -- DGG-122: datos para el asunto "{{solicitante_nombre}}: {{servicio}}".
  SELECT COALESCE(sv.nombre, s.servicio_slug, v_tramite.titulo, 'Trámite'),
         COALESCE(NULLIF(v_tramite.solicitante_nombre, ''), s.solicitante_nombre, '')
    INTO v_servicio, v_solicitante
    FROM public.solicitudes s
    LEFT JOIN public.servicios sv ON sv.id = s.servicio_solicitado_id
   WHERE s.id = v_deriv.solicitud_id;
  v_servicio := COALESCE(v_servicio, v_tramite.titulo, 'Trámite');
  v_solicitante := COALESCE(NULLIF(v_solicitante, ''), 'Cliente');

  SELECT vence_at, revocado_at INTO v_vence, v_revocado
    FROM public.accesos_externos WHERE token = v_deriv.acceso_externo_token;
  IF v_deriv.acceso_externo_token IS NULL OR v_vence IS NULL OR v_vence <= now() OR v_revocado IS NOT NULL THEN
    v_token := public.generar_acceso_externo('solicitud', v_deriv.solicitud_id,
                 v_deriv.destinatario_email, v_deriv.destinatario_nombre, 14, 'Reaviso: info nueva');
    v_url := 'https://www.gestionglobal.ar/externo/' || v_token;
    UPDATE public.solicitud_derivaciones
       SET acceso_externo_token = v_token, acceso_externo_url = v_url WHERE id = v_deriv.id;
  ELSE
    v_token := v_deriv.acceso_externo_token;
    v_url := COALESCE(v_deriv.acceso_externo_url, 'https://www.gestionglobal.ar/externo/' || v_token);
  END IF;
  v_mensaje := COALESCE(NULLIF(btrim(p_mensaje), ''),
    'El cliente completó la documentación que faltaba. Ya podés retomar el trámite con la información actualizada.');
  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables, prioridad,
    programado_para, related_table, related_id
  ) VALUES (
    v_deriv.destinatario_email, v_deriv.destinatario_nombre,
    v_solicitante || ': ' || v_servicio,
    'workflow', 'gestoria-info-nueva-disponible',
    jsonb_build_object('nombre', coalesce(v_deriv.destinatario_nombre, 'gestoría'),
      'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'solicitante_nombre', v_solicitante, 'servicio', v_servicio,
      'mensaje', v_mensaje, 'acceso_url', v_url), 2, now(), 'tramites', p_tramite_id
  );
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente, created_at
  ) VALUES (
    p_tramite_id, 'tramite_enviado',
    'Reaviso a la gestoría (' || v_deriv.destinatario_email || '): hay información nueva para retomar el trámite.'
      || CASE WHEN coalesce(btrim(p_mensaje), '') <> '' THEN ' · ' || btrim(p_mensaje) ELSE '' END,
    '{}'::text[], v_user, false, now()
  );
  RETURN jsonb_build_object('ok', true, 'email', v_deriv.destinatario_email, 'token_regenerado', (v_token <> COALESCE(v_deriv.acceso_externo_token,'')));
END;
$function$;

-- ── 4 · Asuntos: "Nombre Apellido: Trámite" en las 2 plantillas ──
UPDATE public.email_templates
   SET asunto = '{{solicitante_nombre}}: {{servicio}}',
       variables = (SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb)
                    FROM jsonb_array_elements_text(
                      COALESCE(variables, '[]'::jsonb)
                      || '["solicitante_nombre","servicio"]'::jsonb) AS v)
 WHERE slug = 'gestoria-info-nueva-disponible';
UPDATE public.email_templates
   SET asunto = '{{solicitante_nombre}}: {{servicio}}'
 WHERE slug = 'solicitud-derivada-gestoria';
