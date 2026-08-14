-- ============================================================================
-- 0425_dgg139_compartir_tracking_envia_email.sql
-- DGG-139 (hallazgo §6 de DGG-138, decisión Pablo 2026-08-14) · El modal
-- "Compartir con el cliente" de un tracking prometía DOS veces el envío por
-- mail ("El destinatario lo recibe por mail" + toast "También se envió por
-- mail") pero generar_acceso_externo sólo creaba el token: nunca se enviaba
-- nada. Pablo eligió opción (a): mandar el mail de verdad.
-- Mecanismo (R5, multi-tabla → RPC): tramite_compartir_acceso genera el token
-- Y encola el email al destinatario + deja registro en tracking_lineas.
-- ============================================================================

-- (A) Template del email al cliente (manaxer-v1, patrón 0264)
INSERT INTO public.email_templates
  (slug, asunto, nombre, descripcion, from_casilla, layout_version, kicker,
   titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual, incluir_tabla_envio,
   cta_text, cta_url, activo, body_html, body_text)
VALUES (
  'tramite-acceso-compartido',
  'Acceso a tu trámite · {{tramite_codigo}}',
  'Trámite · acceso de seguimiento compartido',
  'Se comparte con el cliente un link de acceso sin login para seguir su trámite (DGG-139).',
  'general', 'manaxer-v1', 'Seguimiento online',
  'Seguí tu trámite', '#0891b2', true,
  '<p>Hola <strong>{{nombre}}</strong>,</p>'
  || '<p>Te compartimos un acceso directo para seguir tu trámite <strong>{{tramite_codigo}}</strong> ({{tramite_titulo}}): vas a ver el estado, los avances y la documentación, sin usuario ni contraseña.</p>'
  || '<div style="background:#eff6ff;border-left:3px solid #0891b2;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">'
  || '<p style="margin:0;color:#0f172a">El enlace tiene una vigencia de {{dias_validez}} días que se renueva sola con cada visita, así que mientras lo uses va a seguir activo.</p></div>'
  || '<p>Cualquier consulta, respondé este correo y te ayudamos.</p>',
  false,
  'Ver mi trámite', '{{acceso_url}}', true,
  '<!doctype html><html><body><p>Hola {{nombre}},</p><p>Te compartimos un acceso directo para seguir tu trámite {{tramite_codigo}} ({{tramite_titulo}}).</p><p>El enlace vale {{dias_validez}} días y se renueva con cada visita.</p><p><a href="{{acceso_url}}">Ver mi trámite</a></p></body></html>',
  'Hola {{nombre}}, te compartimos el acceso a tu trámite {{tramite_codigo}}: {{acceso_url}} (vigencia {{dias_validez}} días, se renueva con cada visita).'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version, activo = true;

-- (B) RPC: token + email + registro, en una sola operación
CREATE OR REPLACE FUNCTION public.tramite_compartir_acceso(
  p_tramite_id uuid,
  p_email text,
  p_nombre text DEFAULT NULL,
  p_dias integer DEFAULT NULL,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tramite public.tramites%ROWTYPE;
  v_dias int;
  v_token text;
  v_url text;
  v_email_id uuid;
  v_nombre text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'email_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe' USING ERRCODE = 'P0002'; END IF;

  -- DGG-138: política 20 días renovables por interacción.
  v_dias := COALESCE(p_dias, 20);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias fuera de rango (1..365)' USING ERRCODE = '22023';
  END IF;

  v_token := public.generar_acceso_externo(
    'tramite', p_tramite_id, p_email, p_nombre, v_dias, p_observaciones);
  v_url := 'https://www.gestionglobal.ar/externo/' || v_token;
  v_nombre := COALESCE(NULLIF(trim(p_nombre), ''), split_part(p_email, '@', 1));

  v_email_id := public.encolar_email(
    'tramite-acceso-compartido', p_email, p_nombre,
    jsonb_build_object(
      'nombre',         v_nombre,
      'tramite_codigo', v_tramite.codigo,
      'tramite_titulo', COALESCE(v_tramite.titulo, 'Trámite'),
      'acceso_url',     v_url,
      'dias_validez',   v_dias::text
    ),
    NULL, NULL, 'tramites', p_tramite_id, 3::smallint
  );

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id, 'tramite_enviado',
    'Acceso de seguimiento compartido con ' || p_email
      || ' (vigencia ' || v_dias || ' días, renovable por visita). Email enviado.',
    '{}'::text[], v_user, false
  );

  RETURN jsonb_build_object('token', v_token, 'url', v_url, 'email_id', v_email_id);
END;
$function$;

-- R6: grants explícitos — lo llaman gerentes logueados; is_staff guarda adentro.
REVOKE ALL ON FUNCTION public.tramite_compartir_acceso(uuid, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_compartir_acceso(uuid, text, text, integer, text) TO authenticated;

COMMENT ON FUNCTION public.tramite_compartir_acceso(uuid, text, text, integer, text) IS
  'DGG-139: comparte un tracking con el cliente — genera el token de acceso externo, ENCOLA el email con el link (template tramite-acceso-compartido) y registra la línea de tracking.';

-- Smoke R16
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tramite_compartir_acceso'
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-139: overload ambiguo (R16)'; END IF;
END $$;
