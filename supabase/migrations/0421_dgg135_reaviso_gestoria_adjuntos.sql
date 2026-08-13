-- ============================================================================
-- 0421 · DGG-135 — Adjuntos opcionales en "Avisar a la gestoría"
--
-- Pedido Pablo (2026-08-13): el modal de reaviso (DGG-133 le sumó mensaje
-- libre) ahora también permite adjuntar archivos opcionales. Viajan como
-- ARCHIVOS REALES en el email: mismo circuito que la derivación original
-- (mig 0208/0396) — staff sube al bucket privado gestoria-adjuntos y la RPC
-- pasa los metas {path, filename, mime, size} a email_queue.attachments_jsonb;
-- el despachador (dispatch-emails, DGG-118) baja y adjunta cada archivo.
--
-- R16: se agrega un parámetro → DROP de la firma vieja (uuid, text) ANTES del
-- CREATE (CREATE OR REPLACE crearía un overload ambiguo y PostgREST rompería
-- con "Could not choose the best candidate function" — caso E-GG-37).
-- Grants re-aplicados (authenticated + service_role, como estaba).
-- Validaciones: array, máx 10 elementos, cada uno con path/filename.
-- ============================================================================

DROP FUNCTION IF EXISTS public.derivacion_reavisar_gestoria(uuid, text);

CREATE FUNCTION public.derivacion_reavisar_gestoria(
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
  v_adj_count int;
  v_elem jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- DGG-135 · validar adjuntos: array, tope 10, cada elemento con path+filename.
  v_adjuntos := COALESCE(p_adjuntos, '[]'::jsonb);
  IF jsonb_typeof(v_adjuntos) <> 'array' THEN
    RAISE EXCEPTION 'p_adjuntos debe ser un array' USING ERRCODE = '22023';
  END IF;
  v_adj_count := jsonb_array_length(v_adjuntos);
  IF v_adj_count > 10 THEN
    RAISE EXCEPTION 'Hasta 10 adjuntos por aviso (recibidos: %)', v_adj_count USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_adjuntos) LOOP
    IF COALESCE(NULLIF(trim(v_elem->>'path'), ''), NULL) IS NULL
       OR COALESCE(NULLIF(trim(v_elem->>'filename'), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'Cada adjunto necesita path y filename' USING ERRCODE = '22023';
    END IF;
  END LOOP;

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
