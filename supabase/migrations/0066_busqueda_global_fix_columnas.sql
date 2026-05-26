-- ============================================================================
-- 0066_busqueda_global_fix_columnas · HOTFIX E-GG-26
--
-- busqueda_global heredó (desde mig 0032 → 0062 → 0065) referencias a
-- columnas que ya no existen o nunca existieron en la BD actual:
--
--   • servicios.categoria      → no existe (sólo categoria_id FK a categorias_servicio).
--                                 Reemplazamos por servicios.codigo como subtitulo.
--   • partners.nombre_fantasia → es nombre_legal.
--   • partners.contacto_email  → es email.
--   • partners.contacto_telefono → es telefono.
--
-- Causa raíz: la mig 0032 se redactó cuando el schema tenía nombres diferentes
-- y al re-crear la RPC en 0062/0065 (para agregar 'solicitud') copiamos el
-- código viejo sin validar contra information_schema. Recordatorio regla 8
-- (E43): siempre validar nombres reales antes de redactar una RPC sobre una
-- tabla pre-existente.
--
-- Prevención agregada: nuevo `comment` en la función mencionando los
-- mappings reales para que cualquier futura extensión vea el contexto.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.busqueda_global(p_q text, p_limit int DEFAULT 8)
RETURNS TABLE(
  kind text, id uuid, titulo text, subtitulo text, url_path text, rank real
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE
  q text := lower(trim(coalesce(p_q, '')));
  qlike text;
  v_is_staff boolean := private.is_staff();
  v_adm uuid := private.current_administracion_id();
BEGIN
  IF length(q) < 2 THEN RETURN; END IF;
  qlike := '%' || q || '%';

  RETURN QUERY
  SELECT 'administracion'::text, a.id, a.nombre,
    COALESCE(NULLIF('CUIT ' || a.cuit, 'CUIT '), a.codigo, '—'),
    '/gerencia/clientes/' || a.id::text,
    (similarity(lower(a.nombre), q)
      + CASE WHEN a.cuit IS NOT NULL AND a.cuit LIKE qlike THEN 0.5 ELSE 0 END
      + CASE WHEN a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike THEN 0.3 ELSE 0 END)::real
  FROM administraciones a
  WHERE (lower(a.nombre) LIKE qlike OR (a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike) OR (a.cuit IS NOT NULL AND a.cuit LIKE qlike))
    AND (v_is_staff OR a.id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'comprobante'::text, c.id,
    c.tipo || ' ' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'),
    COALESCE(c.receptor_razon_social, '—') || ' · $' || to_char(coalesce(c.total, 0), 'FM999G999G999D00'),
    '/gerencia/facturacion/' || c.id::text,
    (similarity(lower(coalesce(c.receptor_razon_social, '')), q)
      + CASE WHEN c.numero::text LIKE qlike THEN 0.6 ELSE 0 END
      + CASE WHEN c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM comprobantes c
  WHERE ((c.receptor_razon_social IS NOT NULL AND lower(c.receptor_razon_social) LIKE qlike) OR c.numero::text LIKE qlike OR (c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike))
    AND (v_is_staff OR c.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'tramite'::text, t.id, t.titulo,
    COALESCE(t.categoria, 'trámite') || ' · ' || COALESCE(t.estado, '—'),
    '/gerencia/trackings/' || t.id::text,
    (similarity(lower(t.titulo), q) + CASE WHEN t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike THEN 0.5 ELSE 0 END)::real
  FROM tramites t
  WHERE (lower(t.titulo) LIKE qlike OR (t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike))
    AND (v_is_staff OR t.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'solicitud'::text, s.id,
    COALESCE(s.solicitante_nombre, s.solicitante_email, 'Solicitud sin nombre'),
    COALESCE(NULLIF(s.servicio_slug, ''), 'servicio') || ' · ' || COALESCE(s.estado, 'recibida'),
    '/gerencia/solicitudes/' || s.id::text,
    (similarity(lower(coalesce(s.solicitante_nombre, '')), q)
      + CASE WHEN s.solicitante_email IS NOT NULL AND lower(s.solicitante_email) LIKE qlike THEN 0.5 ELSE 0 END
      + CASE WHEN s.observaciones IS NOT NULL AND lower(s.observaciones) LIKE qlike THEN 0.2 ELSE 0 END
      + CASE WHEN s.solicitante_telefono IS NOT NULL AND s.solicitante_telefono LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM solicitudes s
  WHERE ((s.solicitante_nombre IS NOT NULL AND lower(s.solicitante_nombre) LIKE qlike)
     OR (s.solicitante_email IS NOT NULL AND lower(s.solicitante_email) LIKE qlike)
     OR (s.observaciones IS NOT NULL AND lower(s.observaciones) LIKE qlike)
     OR (s.solicitante_telefono IS NOT NULL AND s.solicitante_telefono LIKE qlike))
    AND (v_is_staff OR s.cliente_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  RETURN QUERY
  SELECT 'vencimiento'::text, v.id,
    COALESCE(v.descripcion, v.tipo || ' · ' || v.sujeto),
    'Vence ' || to_char(v.fecha_vencimiento, 'DD/MM/YYYY') || ' · ' || COALESCE(v.estado, '—'),
    '/gerencia/vencimientos?vencimiento=' || v.id::text,
    (similarity(lower(coalesce(v.descripcion, v.tipo || ' ' || v.sujeto)), q))::real
  FROM vencimientos v
  WHERE ((v.descripcion IS NOT NULL AND lower(v.descripcion) LIKE qlike) OR lower(v.tipo) LIKE qlike OR lower(v.sujeto) LIKE qlike)
    AND (v_is_staff OR v.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

  -- Servicios: NO existe columna `categoria`, sólo `categoria_id` FK.
  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'servicio'::text, sv.id, sv.nombre,
      COALESCE(sv.descripcion, sv.codigo, '—'),
      '/gerencia/servicios/' || sv.id::text, similarity(lower(sv.nombre), q)::real
    FROM servicios sv
    WHERE lower(sv.nombre) LIKE qlike
       OR (sv.descripcion IS NOT NULL AND lower(sv.descripcion) LIKE qlike)
       OR (sv.codigo IS NOT NULL AND lower(sv.codigo) LIKE qlike)
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

  RETURN QUERY
  SELECT 'curso'::text, cu.id, cu.titulo, COALESCE(cu.modalidad, '—'),
    '/gerencia/campus/' || cu.id::text, similarity(lower(cu.titulo), q)::real
  FROM cursos cu
  WHERE lower(cu.titulo) LIKE qlike
  ORDER BY rank DESC LIMIT p_limit;

  -- Partners: columnas reales = nombre_legal, email, telefono, cuit.
  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'partner'::text, p.id, p.nombre_legal,
      COALESCE(p.email, p.telefono, p.cuit, '—'),
      '/gerencia/partners/' || p.id::text, similarity(lower(p.nombre_legal), q)::real
    FROM partners p
    WHERE lower(p.nombre_legal) LIKE qlike
       OR (p.email IS NOT NULL AND lower(p.email) LIKE qlike)
       OR (p.cuit IS NOT NULL AND p.cuit LIKE qlike)
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

  RETURN QUERY
  SELECT 'formulario'::text, f.id, f.titulo, COALESCE(f.slug, '—'),
    '/gerencia/formularios/' || f.id::text,
    (similarity(lower(f.titulo), q) + CASE WHEN lower(f.slug) LIKE qlike THEN 0.4 ELSE 0 END)::real
  FROM formularios f
  WHERE lower(f.titulo) LIKE qlike OR lower(f.slug) LIKE qlike
  ORDER BY rank DESC LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.busqueda_global(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.busqueda_global(text, int) TO anon;

COMMENT ON FUNCTION public.busqueda_global(text, int) IS
  'DGG-29 / P5-7.D. Search global ⌘K. Kinds: administracion, comprobante, '
  'tramite, solicitud, vencimiento, servicio, curso, partner, formulario. '
  'Trámites URL = /gerencia/trackings/:id. Columnas: servicios usa codigo '
  '(no categoria), partners usa nombre_legal/email/telefono/cuit.';
