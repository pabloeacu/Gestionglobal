-- DGG-95 (2ª ronda, pedido Pablo) · Tras cancelar un trámite, ofrecer a gerencia (opt-in,
-- NO automático) 2 acciones: (A) retirar al alumno de la matrícula del curso, (B) avisar
-- al cliente por mail. Acá el backend: template + RPC de aviso + RPC resolver de matrículas.

-- (B) Template de mail "trámite cancelado" (clon de tramite-resuelto, manaxer-v1).
INSERT INTO public.email_templates (
  slug, nombre, descripcion, asunto, kicker, titulo_visual, color_acento, from_casilla,
  reply_to, mostrar_logo, layout_version, incluir_tabla_envio, cta_text, cta_url, firma,
  activo, variables, body_html, body_text, cuerpo_html_visual
) VALUES (
  'tramite-cancelado', 'Trámite cancelado',
  'Aviso al cliente de que su trámite fue cancelado.',
  'Tu trámite #{{numero}} fue cancelado', 'TRÁMITE CANCELADO', 'Tu trámite fue cancelado',
  '#64748b', 'general', NULL, true, 'manaxer-v1', false, NULL, NULL, 'Equipo Gestión Global',
  true, '["nombre","numero"]'::jsonb,
  '<h2>Trámite cancelado</h2><p>Hola {{nombre}}, te informamos que tu trámite <strong>#{{numero}}</strong> fue cancelado.</p><p>Si tenés alguna consulta, respondé este correo y te ayudamos.</p>',
  'Hola {{nombre}}, te informamos que tu trámite #{{numero}} fue cancelado. Si tenés alguna consulta, respondé este correo.',
  '<h2>Trámite cancelado</h2><p>Hola {{nombre}}, te informamos que tu trámite <strong>#{{numero}}</strong> fue cancelado.</p><p>Si tenés alguna consulta, respondé este correo y te ayudamos.</p>'
)
ON CONFLICT (slug) DO NOTHING;

-- (B) RPC: encola el mail de cancelación al solicitante del trámite.
CREATE OR REPLACE FUNCTION public.tramite_avisar_cancelacion(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text; v_nombre text; v_codigo text; v_admin uuid; v_qid uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  SELECT solicitante_email, solicitante_nombre, codigo, administracion_id
    INTO v_email, v_nombre, v_codigo, v_admin
    FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe' USING ERRCODE='P0002'; END IF;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'El trámite no tiene email del solicitante' USING ERRCODE='22023';
  END IF;

  v_qid := public.encolar_email(
    p_template := 'tramite-cancelado',
    p_to_email := btrim(v_email),
    p_to_nombre := COALESCE(NULLIF(btrim(v_nombre),''), 'Hola'),
    p_variables := jsonb_build_object('nombre', COALESCE(NULLIF(btrim(v_nombre),''), ''),
                                      'numero', COALESCE(v_codigo, '')),
    p_administracion_id := v_admin,
    p_consorcio_id := NULL,
    p_related_table := 'tramites',
    p_related_id := p_tramite_id,
    p_prioridad := 3::smallint
  );
  RETURN jsonb_build_object('ok', true, 'queue_id', v_qid, 'email', btrim(v_email));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tramite_avisar_cancelacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_avisar_cancelacion(uuid) TO authenticated;

-- (A) RPC: info post-cancelación para las ofertas (email del solicitante + matrículas
-- ACTIVAS del alumno resueltas por email → profile → curso_matriculas). No hay link
-- estructural trámite→matrícula (submission_origen siempre NULL, sin puente servicio→curso),
-- así que se resuelve por el email del solicitante; el confirm del front muestra alumno+curso
-- para que gerencia valide antes de retirar.
CREATE OR REPLACE FUNCTION public.tramite_post_cancelacion_info(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text; v_nombre text; v_mats jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  SELECT solicitante_email, solicitante_nombre INTO v_email, v_nombre
    FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe' USING ERRCODE='P0002'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'matricula_id', cm.id,
           'curso_id', cm.curso_id,
           'curso_nombre', c.titulo,
           'alumno_nombre', p.full_name
         ) ORDER BY c.titulo), '[]'::jsonb)
    INTO v_mats
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    JOIN public.curso_matriculas cm ON cm.profile_id = p.id
    JOIN public.cursos c ON c.id = cm.curso_id
   WHERE v_email IS NOT NULL
     AND lower(u.email) = lower(btrim(v_email))
     AND cm.estado = 'activa';

  RETURN jsonb_build_object(
    'solicitante_email', v_email,
    'solicitante_nombre', v_nombre,
    'matriculas', v_mats
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tramite_post_cancelacion_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_post_cancelacion_info(uuid) TO authenticated;
