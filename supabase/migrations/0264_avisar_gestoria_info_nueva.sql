-- ============================================================================
-- 0264_avisar_gestoria_info_nueva.sql
-- DGG-90 (reporte JL #2) · Cuando el cliente completa la documentación pedida, no
-- había forma de avisar a la GESTORÍA EXTERNA (la derivación) que ya puede retomar
-- el trámite. Mecanismo: botón en gerencia → RPC que reavisa a la gestoría con su
-- link de acceso (regenerándolo si venció) + un mensaje. La derivación cuelga de la
-- solicitud (solicitud_derivaciones.solicitud_id); se alcanza por solicitudes.tramite_id.
-- ============================================================================

-- (A) Template del aviso (manaxer-v1 con cuerpo poblado — E-GG-74)
INSERT INTO public.email_templates
  (slug, asunto, nombre, descripcion, from_casilla, layout_version, kicker,
   titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual, incluir_tabla_envio,
   cta_text, cta_url, activo, body_html, body_text)
VALUES (
  'gestoria-info-nueva-disponible',
  'Hay información nueva para retomar · Trámite {{tramite_codigo}}',
  'Gestoría · info nueva disponible',
  'Reaviso a la gestoría externa de que el cliente completó lo solicitado y puede retomar el trámite.',
  'general', 'manaxer-v1', 'Trámite con novedades',
  'Hay información nueva', '#0891b2', true,
  '<p>Hola <strong>{{nombre}}</strong>,</p>'
  || '<p>Hay novedades en el trámite <strong>{{tramite_codigo}}</strong> ({{tramite_titulo}}).</p>'
  || '<div style="background:#eff6ff;border-left:3px solid #0891b2;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">'
  || '<p style="margin:0;color:#0f172a;white-space:pre-wrap">{{mensaje}}</p></div>'
  || '<p>Entrá al trámite para ver la información actualizada (la anterior y la nueva) y retomar la gestión.</p>',
  false,
  'Ver el trámite', '{{acceso_url}}', true,
  '<!doctype html><html><body><p>Hola {{nombre}},</p><p>Hay novedades en el trámite {{tramite_codigo}} ({{tramite_titulo}}).</p><p style="white-space:pre-wrap">{{mensaje}}</p><p><a href="{{acceso_url}}">Ver el trámite</a></p></body></html>',
  'Hola {{nombre}}, hay novedades en el trámite {{tramite_codigo}}. {{mensaje}} Ver: {{acceso_url}}'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version, activo = true;

-- (B) RPC del reaviso
CREATE OR REPLACE FUNCTION public.derivacion_reavisar_gestoria(p_tramite_id uuid, p_mensaje text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_deriv public.solicitud_derivaciones%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_vence timestamptz; v_revocado timestamptz;
  v_token text; v_url text; v_mensaje text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe'; END IF;

  -- última derivación del trámite (vía su solicitud)
  SELECT d.* INTO v_deriv
    FROM public.solicitud_derivaciones d
    JOIN public.solicitudes s ON s.id = d.solicitud_id
   WHERE s.tramite_id = p_tramite_id
   ORDER BY d.enviada_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este trámite no fue derivado a una gestoría' USING ERRCODE = 'P0002';
  END IF;

  -- ¿el token de acceso sigue vigente? si no, regenerar
  SELECT vence_at, revocado_at INTO v_vence, v_revocado
    FROM public.accesos_externos WHERE token = v_deriv.acceso_externo_token;
  IF v_deriv.acceso_externo_token IS NULL OR v_vence IS NULL OR v_vence <= now() OR v_revocado IS NOT NULL THEN
    v_token := public.generar_acceso_externo('solicitud', v_deriv.solicitud_id,
                 v_deriv.destinatario_email, v_deriv.destinatario_nombre, 14, 'Reaviso: info nueva');
    v_url := 'https://www.gestionglobal.ar/externo/' || v_token;
    UPDATE public.solicitud_derivaciones
       SET acceso_externo_token = v_token, acceso_externo_url = v_url
     WHERE id = v_deriv.id;
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
    'Hay información nueva para retomar · Trámite ' || coalesce(v_tramite.codigo, ''),
    'workflow', 'gestoria-info-nueva-disponible',
    jsonb_build_object(
      'nombre', coalesce(v_deriv.destinatario_nombre, 'gestoría'),
      'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'mensaje', v_mensaje, 'acceso_url', v_url),
    2, now(), 'tramites', p_tramite_id
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

REVOKE EXECUTE ON FUNCTION public.derivacion_reavisar_gestoria(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derivacion_reavisar_gestoria(uuid, text) TO authenticated;
