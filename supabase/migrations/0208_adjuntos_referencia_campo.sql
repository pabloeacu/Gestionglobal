-- 0208 · Referencia del campo (consigna) en cada documento adjunto.
-- Pablo 2026-06-08: "cada documento adjunto debe tener la referencia del campo
-- que completa" (ej. "DNI Frente: archivo.jpg"). El lado front (wizard Paso 2)
-- resuelve la etiqueta con el schema en memoria; acá va el lado server:
--   1) helper reusable slug→label (espejo de src/lib/formSchema.ts).
--   2) gestor_obtener_info_solicitud → devuelve `label` por adjunto (panel).
--   3) solicitud_derivar_v2 → arma la var `documentos` (lista etiquetada) para
--      el mail al gestor, + la plantilla la renderiza.
-- R16: ambas RPCs mantienen su firma → CREATE OR REPLACE seguro (sin overload).
-- R18: smoke del helper embebido (no aborta en éxito); e2e de la RPC en §6.

-- ---------------------------------------------------------------------------
-- 1) Helper: slug de campo → etiqueta humana, recorriendo el schema (jsonpath
--    recursivo). Espejo de fieldLabelMap() en el front. Fallback: humaniza.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.form_field_label(p_schema jsonb, p_field text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(
      (
        SELECT obj->>'label'
        FROM jsonb_path_query(
               COALESCE(p_schema, '{}'::jsonb),
               '$.** ? (@.name == $f && exists(@.label))',
               jsonb_build_object('f', p_field)
             ) AS obj
        -- Evita labels que son HTML (campos type=html); no son file fields.
        WHERE position('<' in COALESCE(obj->>'label','')) = 0
        LIMIT 1
      ),
      ''
    ),
    -- Fallback: "dni_frente" → "Dni frente". Sólo capitaliza la 1ra letra
    -- (espejo EXACTO de humanizeFieldName() en TS; NO initcap, que capitaliza
    -- cada palabra).
    (
      SELECT upper(left(t, 1)) || substr(t, 2)
      FROM (
        SELECT btrim(regexp_replace(COALESCE(NULLIF(p_field, ''), 'archivo'), '[_\s-]+', ' ', 'g')) AS t
      ) z
    )
  );
$$;

COMMENT ON FUNCTION private.form_field_label(jsonb, text) IS
  'DGG-56: resuelve slug de campo → etiqueta humana desde el schema del formulario. Espejo de src/lib/formSchema.ts. Usado por el panel y el mail al gestor.';

-- ---------------------------------------------------------------------------
-- 2) Panel del gestor: cada adjunto ahora trae `label` (la consigna).
--    Misma firma → CREATE OR REPLACE. Sólo cambia: select f.schema + el
--    jsonb_build_object de adjuntos suma 'label'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gestor_obtener_info_solicitud(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    -- Adjuntos del formulario con la consigna (label) que completa cada uno.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'field_name', fa.field_name,
        'label', private.form_field_label(v_form_schema, fa.field_name),
        'filename_original', fa.filename_original,
        'storage_path', fa.storage_path
      ) ORDER BY fa.uploaded_at), '[]'::jsonb)
      INTO v_adjuntos
      FROM public.formulario_adjuntos fa
      WHERE fa.submission_id = v_sol.formulario_submission_id;
  ELSE
    v_datos := '{}'::jsonb;
    v_adjuntos := '[]'::jsonb;
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
    'created_at',         v_sol.created_at
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Mail al gestor: solicitud_derivar_v2 arma la var `documentos` (lista
--    "— Consigna: archivo" de los documentos del cliente). Misma firma.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_derivar_v2(p_solicitud_id uuid, p_destinatario_email text, p_destinatario_nombre text, p_plantilla_slug text DEFAULT 'solicitud-derivada-gestoria'::text, p_observaciones text DEFAULT NULL::text, p_dias_validez integer DEFAULT 14, p_monto_pago numeric DEFAULT NULL::numeric, p_adjuntos jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  -- Documentación del cliente con la referencia del campo (consigna) que
  -- completa cada archivo, para que en el mail no queden sueltos (Pablo).
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
     WHERE fa.submission_id = v_sol.formulario_submission_id;
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

  -- Encolamos email_queue directamente para poder pasar attachments_jsonb
  -- (encolar_email() RPC no soporta attachments).
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
      '{}'::text[], auth.uid(), false,  -- visible_cliente = false (es interno)
      private.dias_habiles_add(now(), 5)
    );
  END IF;

  RETURN v_der_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Plantilla del mail al gestor: render de la lista de documentos.
--    El wrapper es estático (no escapado); `white-space:pre-line` hace los
--    saltos de línea. Si `documentos` viene vacío, el div queda invisible.
--    El contenido (label/filename) lo escapa renderVars (sin XSS).
-- ---------------------------------------------------------------------------
UPDATE public.email_templates
SET cuerpo_html_visual = cuerpo_html_visual
      || '<div style="white-space:pre-line;margin-top:12px;font-size:14px;color:#334155;">{{documentos}}</div>',
    body_html = replace(
      body_html,
      '<p>Accedé a la documentación',
      '<div style="white-space:pre-line;margin:6px 0;font-size:14px;color:#334155;">{{documentos}}</div><p>Accedé a la documentación'
    ),
    variables = (COALESCE(variables, '[]'::jsonb) || '["documentos"]'::jsonb)
WHERE slug = 'solicitud-derivada-gestoria'
  -- Idempotente: no re-anexar el bloque si ya está (re-run de la migración).
  AND cuerpo_html_visual NOT LIKE '%{{documentos}}%';

-- ---------------------------------------------------------------------------
-- 5) Smoke embebido (R18): valida el helper sin abortar en éxito.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF private.form_field_label(
       '{"sections":[{"fields":[{"name":"dni_frente","label":"DNI Frente"}]}]}'::jsonb,
       'dni_frente') <> 'DNI Frente' THEN
    RAISE EXCEPTION 'smoke 0208: resolución de label desde schema falló';
  END IF;
  IF private.form_field_label('{}'::jsonb, 'comprobante_pago') <> 'Comprobante pago' THEN
    RAISE EXCEPTION 'smoke 0208: fallback humanize falló';
  END IF;
  IF private.form_field_label(NULL, 'x') IS NULL THEN
    RAISE EXCEPTION 'smoke 0208: schema NULL debe humanizar, no devolver NULL';
  END IF;
  RAISE NOTICE 'smoke 0208 OK: form_field_label resuelve label + fallback + NULL-safe';
END $$;
