-- ============================================================================
-- Migration: 0095_perfil_gestor_externo
-- Fecha: 2026-05-28
-- DGG-XX · Fix #147: Perfil Gestor (acceso externo por token).
--
-- El "gestor" NO es un usuario de profiles. Es un destinatario externo que
-- recibe una URL /externo/<token> (acceso_externo) tras la derivación. Desde
-- esa URL puede:
--   1. VER el detalle de la solicitud + sus líneas de avance ya cargadas
--   2. CARGAR avance/documentación final → genera tracking_lineas con
--      visible_cliente=true y dispara el trigger (email+push+notif al cliente)
--
-- Cambios:
--   A) Fix URL `/acceso/<token>` → `/externo/<token>` en solicitud_derivar
--   B) Nueva categoría `gestor_avance` en tracking_categorias_config
--   C) RPC público `gestor_listar_avances(p_token)` — line previas del trámite
--   D) RPC público `gestor_cargar_avance(p_token, p_descripcion, p_archivos_urls)`
--   E) Update template `solicitud-derivada-gestoria` con CTA premium
-- ============================================================================

-- A) Fix URL en solicitud_derivar (/acceso/ → /externo/) ---------------------

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
      USING 'solicitud', p_solicitud_id, p_destinatario_email, 14;
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

  -- Línea auto de derivación (mig 0094)
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
      true
    );
  END IF;

  RETURN v_der_id;
END;
$$;

-- B) Categoría gestor_avance (idempotente sin ON CONFLICT por servicio_id NULL)

INSERT INTO public.tracking_categorias_config (slug, label, icono, color, orden)
SELECT 'gestor_avance', 'Aporte de gestoría externa', 'briefcase', 'cyan', 35
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracking_categorias_config
  WHERE slug = 'gestor_avance' AND servicio_id IS NULL
);

-- C) RPC pública gestor_listar_avances --------------------------------------

CREATE OR REPLACE FUNCTION public.gestor_listar_avances(p_token text)
RETURNS TABLE (
  id uuid,
  categoria_slug text,
  categoria_label text,
  categoria_icono text,
  categoria_color text,
  descripcion text,
  archivos_urls text[],
  autor_nombre text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
BEGIN
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002';
  END IF;
  IF v_acc.revocado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501';
  END IF;
  IF v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo <> 'solicitud' THEN
    RAISE EXCEPTION 'Token no corresponde a una solicitud' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = v_acc.recurso_id;
  IF v_sol.id IS NULL OR v_sol.tramite_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT tl.id,
           tl.categoria,
           COALESCE(cc.label, tl.categoria),
           COALESCE(cc.icono, 'circle'),
           COALESCE(cc.color, 'slate'),
           tl.descripcion,
           COALESCE(tl.archivos_urls, '{}'::text[]),
           COALESCE(p.full_name, 'Gestión Global'),
           tl.created_at
      FROM public.tracking_lineas tl
      LEFT JOIN public.tracking_categorias_config cc
        ON cc.slug = tl.categoria AND cc.servicio_id IS NULL
      LEFT JOIN public.profiles p ON p.id = tl.autor_id
     WHERE tl.tramite_id = v_sol.tramite_id
       AND tl.visible_cliente = true
     ORDER BY tl.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gestor_listar_avances(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.gestor_listar_avances(text) TO anon, authenticated;

-- D) RPC pública gestor_cargar_avance ---------------------------------------

CREATE OR REPLACE FUNCTION public.gestor_cargar_avance(
  p_token         text,
  p_descripcion   text,
  p_archivos_urls text[] DEFAULT '{}'::text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_destinatario_label text;
  v_descripcion_final  text;
  v_linea_id uuid;
BEGIN
  IF COALESCE(trim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002';
  END IF;
  IF v_acc.revocado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501';
  END IF;
  IF v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo <> 'solicitud' THEN
    RAISE EXCEPTION 'Token no corresponde a una solicitud' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = v_acc.recurso_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.tramite_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado'
      USING ERRCODE = '22023';
  END IF;

  v_destinatario_label := COALESCE(
    NULLIF(v_acc.nombre_destinatario, ''),
    v_acc.email_destinatario
  );
  v_descripcion_final := '✉️ Aporte de gestoría externa (' || v_destinatario_label
    || E'):\n\n' || trim(p_descripcion);

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente
  ) VALUES (
    v_sol.tramite_id,
    'gestor_avance',
    v_descripcion_final,
    COALESCE(p_archivos_urls, '{}'::text[]),
    NULL,
    true
  )
  RETURNING id INTO v_linea_id;

  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()),
         ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE token = p_token;

  RETURN v_linea_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gestor_cargar_avance(text, text, text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.gestor_cargar_avance(text, text, text[]) TO anon, authenticated;

-- E) Template solicitud-derivada-gestoria con CTA premium -------------------

UPDATE public.email_templates
   SET layout_version = 'manaxer-v1',
       kicker = 'Derivación a gestoría',
       titulo_visual = 'Recibiste un trámite de Gestión Global',
       cuerpo_html_visual = '<p>Hola <strong>{{destinatario_nombre}}</strong>,</p>'
         || '<p>Te derivamos un trámite del servicio <strong>{{servicio}}</strong> '
         || 'iniciado por <strong>{{solicitante_nombre}}</strong> '
         || '({{solicitante_email}}).</p>'
         || '<p>Cuando lo tengas resuelto, ingresá al enlace seguro y cargá el '
         || 'avance o la documentación final. El cliente recibirá una '
         || 'notificación automática.</p>'
         || '<p>{{observaciones}}</p>',
       cta_text = 'Cargar avance / documentación',
       cta_url  = '{{acceso_url}}',
       updated_at = now()
 WHERE slug = 'solicitud-derivada-gestoria';
