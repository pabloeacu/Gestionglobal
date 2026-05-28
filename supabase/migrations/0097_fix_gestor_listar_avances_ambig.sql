-- ============================================================================
-- Migration: 0097_fix_gestor_listar_avances_ambig
-- Fecha: 2026-05-28
-- DGG-XX · Fix #147 sub-bug: las RPCs gestor_* hacían WHERE id = ... sin
-- prefijar la tabla; como la función RETURNS TABLE (id, ...), Postgres
-- interpretaba "id" como variable de salida y lanzaba "column reference id
-- is ambiguous". Prefijamos solicitudes.id y accesos_externos.token.
-- ============================================================================

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
  SELECT * INTO v_acc FROM public.accesos_externos
   WHERE public.accesos_externos.token = p_token;
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

  SELECT * INTO v_sol FROM public.solicitudes s
   WHERE s.id = v_acc.recurso_id;
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

  SELECT * INTO v_acc FROM public.accesos_externos
   WHERE public.accesos_externos.token = p_token;
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

  SELECT * INTO v_sol FROM public.solicitudes s
   WHERE s.id = v_acc.recurso_id;
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
  RETURNING tracking_lineas.id INTO v_linea_id;

  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()),
         ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE public.accesos_externos.token = p_token;

  RETURN v_linea_id;
END;
$$;
