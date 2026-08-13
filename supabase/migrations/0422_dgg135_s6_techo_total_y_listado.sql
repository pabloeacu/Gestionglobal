-- ============================================================================
-- 0422 · DGG-135 §6 — Fixes de la doble auditoría sobre el reaviso con adjuntos
--
-- (1) CRÍTICO: el despachador de emails (dispatch-emails, DGG-118) corta los
--     adjuntos en MAX_ATTACH_B64_TOTAL = 7.000.000 chars base64 ≈ 5,25 MB
--     binarios TOTALES por mail y OMITE EN SILENCIO el excedente (el mail sale
--     'sent' igual). gestor-firmar-adjunto NO firma gestoria-adjuntos, así que
--     el adjunto del email es el ÚNICO canal de entrega a la gestoría → un
--     excedente silencioso = pérdida silenciosa clase E-GG-177. Guard servidor:
--     RAISE si SUM(size) > 4,5 MB (espejo con margen para el inflado b64 4/3).
--     El modal espeja el mismo techo del lado cliente.
-- (2) menor: variables.adjuntos_count era data muerta — la plantilla
--     gestoria-info-nueva-disponible no la renderiza (renderVars es sustitución
--     plana, sin condicionales). La mención va ANEXADA a v_mensaje, que la
--     plantilla sí renderiza con white-space:pre-wrap.
-- (3) media: los adjuntos del reaviso no aparecían en el listado E-GG-90 del
--     trámite — tramite_docs_cliente lee solicitud_derivaciones.adjuntos_jsonb,
--     no el folder del bucket. Se anexan ahí (dedupe por path para reintentos).
-- (+) hardening: los elementos se re-construyen con SOLO {path, filename,
--     mime, size} — claves extra del JSON entrante (content_b64,
--     storage_bucket…) no llegan jamás a attachments_jsonb.
--
-- R16: la firma NO cambia (uuid, text, jsonb) → CREATE OR REPLACE es seguro
-- (no crea overload). Smoke de overloads al cierre igual.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.derivacion_reavisar_gestoria(
  p_tramite_id uuid,
  p_mensaje text DEFAULT NULL::text,
  p_adjuntos jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_deriv public.solicitud_derivaciones%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_vence timestamptz; v_revocado timestamptz;
  v_token text; v_url text; v_mensaje text;
  v_servicio text;
  v_solicitante text;
  v_adjuntos jsonb;
  v_adj_nuevos jsonb;
  v_adj_count int;
  v_elem jsonb;
  v_total_bytes bigint := 0;
  -- §6 crítico: espejo del techo real del despachador (4,5 MB raw < 5,25 MB
  -- que permite MAX_ATTACH_B64_TOTAL tras el inflado base64 4/3).
  c_max_total_bytes CONSTANT bigint := 4718592; -- 4,5 MB
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- DGG-135 · validar adjuntos: array, tope 10, cada elemento con path+filename,
  -- tamaño TOTAL ≤ 4,5 MB. Se re-construye cada elemento con SOLO las 4 claves
  -- del contrato (hardening: nada verbatim hacia attachments_jsonb).
  IF jsonb_typeof(COALESCE(p_adjuntos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_adjuntos debe ser un array' USING ERRCODE = '22023';
  END IF;
  v_adj_count := jsonb_array_length(COALESCE(p_adjuntos, '[]'::jsonb));
  IF v_adj_count > 10 THEN
    RAISE EXCEPTION 'Hasta 10 adjuntos por aviso (recibidos: %)', v_adj_count USING ERRCODE = '22023';
  END IF;
  v_adjuntos := '[]'::jsonb;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]'::jsonb)) LOOP
    IF COALESCE(NULLIF(trim(v_elem->>'path'), ''), NULL) IS NULL
       OR COALESCE(NULLIF(trim(v_elem->>'filename'), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'Cada adjunto necesita path y filename' USING ERRCODE = '22023';
    END IF;
    v_total_bytes := v_total_bytes + GREATEST(COALESCE((v_elem->>'size')::bigint, 0), 0);
    v_adjuntos := v_adjuntos || jsonb_build_array(jsonb_build_object(
      'path', trim(v_elem->>'path'),
      'filename', trim(v_elem->>'filename'),
      'mime', COALESCE(NULLIF(trim(v_elem->>'mime'), ''), 'application/octet-stream'),
      'size', COALESCE((v_elem->>'size')::bigint, 0)
    ));
  END LOOP;
  IF v_total_bytes > c_max_total_bytes THEN
    RAISE EXCEPTION 'Los adjuntos superan el máximo de 4,5 MB en total del email (recibidos: % bytes)', v_total_bytes
      USING ERRCODE = '22023';
  END IF;

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
  -- §6 menor: la plantilla no renderiza adjuntos_count — la mención de los
  -- adjuntos viaja DENTRO del mensaje (que sí se renderiza con pre-wrap).
  IF v_adj_count > 0 THEN
    v_mensaje := v_mensaje || E'\n\nTe adjuntamos ' || v_adj_count || ' archivo'
      || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' en este email.';
  END IF;

  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables,
    attachments_jsonb, prioridad, programado_para, related_table, related_id
  ) VALUES (
    v_deriv.destinatario_email, v_deriv.destinatario_nombre,
    v_solicitante || ': ' || v_servicio,
    'workflow', 'gestoria-info-nueva-disponible',
    jsonb_build_object('nombre', coalesce(v_deriv.destinatario_nombre, 'gestoría'),
      'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'solicitante_nombre', v_solicitante, 'servicio', v_servicio,
      'mensaje', v_mensaje, 'acceso_url', v_url,
      'adjuntos_count', v_adj_count::text),
    v_adjuntos, 2, now(), 'tramites', p_tramite_id
  );

  -- §6 media: anexar los adjuntos a la derivación para que el listado E-GG-90
  -- del trámite (tramite_docs_cliente lee d.adjuntos_jsonb) los muestre.
  -- Dedupe por path: un reintento del envío no duplica entradas.
  IF v_adj_count > 0 THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_adj_nuevos
      FROM jsonb_array_elements(v_adjuntos) e
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(v_deriv.adjuntos_jsonb, '[]'::jsonb)) x
        WHERE x->>'path' = e->>'path');
    IF jsonb_array_length(v_adj_nuevos) > 0 THEN
      UPDATE public.solicitud_derivaciones
         SET adjuntos_jsonb = COALESCE(adjuntos_jsonb, '[]'::jsonb) || v_adj_nuevos
       WHERE id = v_deriv.id;
    END IF;
  END IF;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente, created_at
  ) VALUES (
    p_tramite_id, 'tramite_enviado',
    'Reaviso a la gestoría (' || v_deriv.destinatario_email || '): hay información nueva para retomar el trámite.'
      || CASE WHEN coalesce(btrim(p_mensaje), '') <> '' THEN ' · ' || btrim(p_mensaje) ELSE '' END
      || CASE WHEN v_adj_count > 0
              THEN ' · ' || v_adj_count || ' archivo' || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' adjunto' || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' en el email'
              ELSE '' END,
    '{}'::text[], v_user, false, now()
  );

  RETURN jsonb_build_object('ok', true, 'email', v_deriv.destinatario_email,
    'adjuntos', v_adj_count,
    'token_regenerado', (v_token <> COALESCE(v_deriv.acceso_externo_token,'')));
END;
$function$;

REVOKE ALL ON FUNCTION public.derivacion_reavisar_gestoria(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derivacion_reavisar_gestoria(uuid, text, jsonb) TO authenticated, service_role;
