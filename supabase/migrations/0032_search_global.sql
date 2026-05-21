-- ============================================================================
-- 0032_search_global · busqueda global ⌘K end-to-end.
--
-- Una sola RPC `public.busqueda_global(p_q, p_limit)` que devuelve filas
-- normalizadas (kind, id, titulo, subtitulo, url_path, rank) cruzando 7
-- entidades del dominio (administraciones, comprobantes, tramites, servicios,
-- cursos, partners, formularios).
--
-- Tenancy guard (regla 12 / E45 / E49): cada SELECT por entidad sensible
-- filtra `private.is_staff() OR administracion_id = private.current_administracion_id()`.
-- pg_trgm + ilike para fuzzy + substring; ordenamos por similitud al final.
--
-- Cita: D-UX command palette, regla 8 (naming híbrido E43, validado contra
-- information_schema antes de redactar el RPC).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.busqueda_global(p_q text, p_limit int DEFAULT 8)
RETURNS TABLE(
  kind text,
  id uuid,
  titulo text,
  subtitulo text,
  url_path text,
  rank real
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q text := lower(trim(coalesce(p_q, '')));
  qlike text;
  v_is_staff boolean := private.is_staff();
  v_adm uuid := private.current_administracion_id();
BEGIN
  IF length(q) < 2 THEN
    RETURN;
  END IF;
  qlike := '%' || q || '%';

  -- Administraciones: staff ve todo; un administrador sólo la suya.
  RETURN QUERY
  SELECT
    'administracion'::text,
    a.id,
    a.nombre,
    COALESCE(NULLIF('CUIT ' || a.cuit, 'CUIT '), a.codigo, '—'),
    '/gerencia/clientes/' || a.id::text,
    (similarity(lower(a.nombre), q)
      + CASE WHEN a.cuit IS NOT NULL AND a.cuit LIKE qlike THEN 0.5 ELSE 0 END
      + CASE WHEN a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike THEN 0.3 ELSE 0 END
    )::real
  FROM administraciones a
  WHERE (
        lower(a.nombre) LIKE qlike
     OR (a.codigo IS NOT NULL AND lower(a.codigo) LIKE qlike)
     OR (a.cuit IS NOT NULL AND a.cuit LIKE qlike)
  )
    AND (v_is_staff OR a.id = v_adm)
  ORDER BY rank DESC
  LIMIT p_limit;

  -- Comprobantes: staff o admin propietaria.
  RETURN QUERY
  SELECT
    'comprobante'::text,
    c.id,
    c.tipo || ' ' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'),
    COALESCE(c.receptor_razon_social, '—') || ' · $' || to_char(coalesce(c.total, 0), 'FM999G999G999D00'),
    '/gerencia/facturacion/' || c.id::text,
    (similarity(lower(coalesce(c.receptor_razon_social, '')), q)
      + CASE WHEN c.numero::text LIKE qlike THEN 0.6 ELSE 0 END
      + CASE WHEN c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike THEN 0.4 ELSE 0 END
    )::real
  FROM comprobantes c
  WHERE (
        (c.receptor_razon_social IS NOT NULL AND lower(c.receptor_razon_social) LIKE qlike)
     OR c.numero::text LIKE qlike
     OR (c.receptor_numero_documento IS NOT NULL AND c.receptor_numero_documento LIKE qlike)
  )
    AND (v_is_staff OR c.administracion_id = v_adm)
  ORDER BY rank DESC
  LIMIT p_limit;

  -- Trámites.
  RETURN QUERY
  SELECT
    'tramite'::text,
    t.id,
    t.titulo,
    COALESCE(t.categoria, 'trámite') || ' · ' || COALESCE(t.estado, '—'),
    '/gerencia/tramites/' || t.id::text,
    (similarity(lower(t.titulo), q)
      + CASE WHEN t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike THEN 0.5 ELSE 0 END
    )::real
  FROM tramites t
  WHERE (
        lower(t.titulo) LIKE qlike
     OR (t.codigo IS NOT NULL AND lower(t.codigo) LIKE qlike)
  )
    AND (v_is_staff OR t.administracion_id = v_adm)
  ORDER BY rank DESC
  LIMIT p_limit;

  -- Vencimientos: lista (no hay detail por id, navegamos al listado filtrado).
  RETURN QUERY
  SELECT
    'vencimiento'::text,
    v.id,
    COALESCE(v.descripcion, v.tipo || ' · ' || v.sujeto),
    'Vence ' || to_char(v.fecha_vencimiento, 'DD/MM/YYYY') || ' · ' || COALESCE(v.estado, '—'),
    '/gerencia/vencimientos?vencimiento=' || v.id::text,
    (similarity(lower(coalesce(v.descripcion, '')), q)
      + CASE WHEN lower(v.tipo) LIKE qlike THEN 0.3 ELSE 0 END
      + CASE WHEN lower(v.sujeto) LIKE qlike THEN 0.3 ELSE 0 END
    )::real
  FROM vencimientos v
  WHERE (
        (v.descripcion IS NOT NULL AND lower(v.descripcion) LIKE qlike)
     OR lower(v.tipo) LIKE qlike
     OR lower(v.sujeto) LIKE qlike
  )
    AND (v_is_staff OR v.administracion_id = v_adm)
  ORDER BY rank DESC
  LIMIT p_limit;

  -- Servicios: solo staff (catálogo interno).
  IF v_is_staff THEN
    RETURN QUERY
    SELECT
      'servicio'::text,
      s.id,
      s.nombre,
      COALESCE(s.codigo, '—'),
      '/gerencia/servicios/' || s.id::text,
      (similarity(lower(s.nombre), q)
        + CASE WHEN lower(s.codigo) LIKE qlike THEN 0.4 ELSE 0 END
      )::real
    FROM servicios s
    WHERE (
          lower(s.nombre) LIKE qlike
       OR (s.codigo IS NOT NULL AND lower(s.codigo) LIKE qlike)
    )
    ORDER BY rank DESC
    LIMIT p_limit;
  END IF;

  -- Cursos: público (catálogo abierto). Staff o cualquiera autenticado puede ver.
  RETURN QUERY
  SELECT
    'curso'::text,
    cu.id,
    cu.titulo,
    COALESCE(cu.modalidad, '—') || CASE WHEN cu.activo THEN '' ELSE ' · inactivo' END,
    '/gerencia/campus/' || cu.id::text,
    (similarity(lower(cu.titulo), q)
      + CASE WHEN lower(cu.slug) LIKE qlike THEN 0.4 ELSE 0 END
    )::real
  FROM cursos cu
  WHERE (
        lower(cu.titulo) LIKE qlike
     OR lower(cu.slug) LIKE qlike
  )
  ORDER BY rank DESC
  LIMIT p_limit;

  -- Partners: solo staff.
  IF v_is_staff THEN
    RETURN QUERY
    SELECT
      'partner'::text,
      p.id,
      p.nombre_legal,
      COALESCE(NULLIF('CUIT ' || p.cuit, 'CUIT '), p.slug),
      '/gerencia/partners/' || p.id::text,
      (similarity(lower(p.nombre_legal), q)
        + CASE WHEN lower(p.slug) LIKE qlike THEN 0.3 ELSE 0 END
        + CASE WHEN p.cuit IS NOT NULL AND p.cuit LIKE qlike THEN 0.5 ELSE 0 END
      )::real
    FROM partners p
    WHERE (
          lower(p.nombre_legal) LIKE qlike
       OR lower(p.slug) LIKE qlike
       OR (p.cuit IS NOT NULL AND p.cuit LIKE qlike)
    )
    ORDER BY rank DESC
    LIMIT p_limit;
  END IF;

  -- Formularios activos (públicos).
  RETURN QUERY
  SELECT
    'formulario'::text,
    f.id,
    f.titulo,
    f.slug,
    '/formulario/' || f.slug,
    (similarity(lower(f.titulo), q)
      + CASE WHEN lower(f.slug) LIKE qlike THEN 0.4 ELSE 0 END
    )::real
  FROM formularios f
  WHERE (
        lower(f.titulo) LIKE qlike
     OR lower(f.slug) LIKE qlike
  )
    AND f.activo
  ORDER BY rank DESC
  LIMIT p_limit;

  RETURN;
END;
$$;

-- Sólo el rol authenticated puede invocarla.
REVOKE EXECUTE ON FUNCTION public.busqueda_global(text, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.busqueda_global(text, int) TO authenticated;

COMMENT ON FUNCTION public.busqueda_global(text, int) IS
  'Búsqueda global (⌘K) end-to-end. Devuelve filas normalizadas { kind, id, titulo, subtitulo, url_path, rank } sobre 7+ entidades, con tenancy guard inline (staff ve todo; administrador sólo la suya).';
