-- ============================================================================
-- 0426_dgg139_s6_trazabilidad_y_copy.sql
-- DGG-139 §6 · 3 fixes de la auditoría de cierre (workflow 6 agentes):
--  (1) encolar_email recibía p_administracion_id=NULL (calco del patrón
--      gestoría de 0116, que acá no aplica: el destinatario ES el cliente).
--      Con NULL el mail no aparece en el historial admin-scoped de sent_emails
--      (RLS filtra por administracion_id) ni en los filtros de gerencia.
--      Ahora pasa v_tramite.administracion_id + consorcio_id (patrón 0319).
--  (2) to_nombre iba con p_nombre crudo (podía salir NULL en el header To:);
--      ahora usa v_nombre (mismo fallback que el saludo del cuerpo).
--  (3) El template prometía "avances y documentación" que la página
--      /externo/<token> NO muestra para trámites (historial/adjuntos van
--      vacíos) — la misma sobre-promesa que originó DGG-139. Copy honesto.
-- ============================================================================

-- (3) Copy honesto del template
UPDATE public.email_templates
   SET cuerpo_html_visual =
     '<p>Hola <strong>{{nombre}}</strong>,</p>'
     || '<p>Te compartimos un acceso directo para seguir tu trámite <strong>{{tramite_codigo}}</strong> ({{tramite_titulo}}): vas a ver el estado y el detalle actualizado, sin usuario ni contraseña.</p>'
     || '<div style="background:#eff6ff;border-left:3px solid #0891b2;padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0">'
     || '<p style="margin:0;color:#0f172a">El enlace tiene una vigencia de {{dias_validez}} días que se renueva sola con cada visita, así que mientras lo uses va a seguir activo.</p></div>'
     || '<p>Cualquier consulta, respondé este correo y te ayudamos.</p>',
       body_html = '<!doctype html><html><body><p>Hola {{nombre}},</p><p>Te compartimos un acceso directo para seguir tu trámite {{tramite_codigo}} ({{tramite_titulo}}): el estado y el detalle actualizado, sin usuario ni contraseña.</p><p>El enlace vale {{dias_validez}} días y se renueva con cada visita.</p><p><a href="{{acceso_url}}">Ver mi trámite</a></p></body></html>',
       body_text = 'Hola {{nombre}}, te compartimos el acceso a tu trámite {{tramite_codigo}} (estado y detalle actualizado): {{acceso_url}} (vigencia {{dias_validez}} días, se renueva con cada visita).',
       updated_at = now()
 WHERE slug = 'tramite-acceso-compartido';

-- (1)+(2) RPC: misma firma → CREATE OR REPLACE seguro (R16, smoke al pie)
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

  -- §6 (1)+(2): admin/consorcio del trámite para trazabilidad (patrón 0319);
  -- v_nombre también en el To: (antes iba p_nombre crudo, podía salir NULL).
  v_email_id := public.encolar_email(
    'tramite-acceso-compartido', p_email, v_nombre,
    jsonb_build_object(
      'nombre',         v_nombre,
      'tramite_codigo', v_tramite.codigo,
      'tramite_titulo', COALESCE(v_tramite.titulo, 'Trámite'),
      'acceso_url',     v_url,
      'dias_validez',   v_dias::text
    ),
    v_tramite.administracion_id, v_tramite.consorcio_id, 'tramites', p_tramite_id, 3::smallint
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

-- Smoke R16
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tramite_compartir_acceso'
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-139 0426: overload ambiguo (R16)'; END IF;
END $$;
