-- 0682 · DGG-248 · Consistencia de los lectores de la familia 'declarado' +
-- hardening del invariante de unicidad. Capitaliza hallazgos de la doble
-- auditoría §6 del chunk (DGG-248): al multiplicar ~4x las filas declaradas
-- (son client-only, R14 tag AUTO/derivadas), tres lectores de GERENCIA las
-- dejaban colar, y el roll anual no tenía garantía dura de unicidad.
--
-- E-GG-270 (agenda unificada): la rama 'vencimiento' de vw_agenda_unificada
--   no excluía origen='declarado' → las filas declaradas (client-only) entraban
--   al calendario personal de cada gerente, encima rotuladas 'Vencimiento: Otro'
--   (el CASE no mapeaba los tipos declarados). Fix: excluir declarado + extender
--   el CASE a los tipos oficiales que hoy también caían en 'Otro' (renovacion_rpac,
--   curso_actualizacion, curso_rpa_caba).
-- E-GG-271 (KPI Inicio gerencia vs grilla, patrón R19): kpis_dashboard_global
--   contaba 'vencimientos_proximos' SIN excluir declarado, mientras la grilla
--   (proximos_vencimientos) y el widget del mismo home SÍ los excluyen → el
--   número del strip no cuadraba con la lista de abajo. Fix: mismo filtro.
-- E-GG-272 (buscador global): el bloque 'vencimiento' de busqueda_global no
--   excluía declarado → hits fantasma (deep-link a una grilla que no los lista).
-- E-GG-273 (unicidad roll anual): no había índice que garantice 1 sola fila
--   declarada activa por (admin,tipo). Vector latente: marcar_renovado() hacía
--   INSERT(vigente)→UPDATE(viejo→renovado), dejando 2 'vigente' un instante.
--   Fix: reordenar marcar_renovado (UPDATE→renovado primero, INSERT después)
--   + índice único parcial que blinda el invariante que todo el motor asume.

-- Guard: abortar si existieran duplicados declarados (el índice fallaría).
DO $$
DECLARE v_dups int;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT 1 FROM public.vencimientos
    WHERE origen='declarado' AND estado IN ('vigente','vencido')
    GROUP BY administracion_id, tipo HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Abort 0682: % duplicados (admin,tipo) declarados vigentes/vencidos — limpiar antes de crear el índice', v_dups;
  END IF;
END $$;

-- ── E-GG-270 · vw_agenda_unificada: excluir declarado de la rama vencimiento
--    + etiquetar los tipos oficiales que caían en 'Otro'.
CREATE OR REPLACE VIEW public.vw_agenda_unificada AS
 SELECT 'personal'::text AS fuente, e.id AS origen_id, e.owner_id, e.title,
    e.start_at, e.end_at, e.all_day, 'personal'::text AS category_hint,
    COALESCE(e.color_override, c.color, '#06b6d4'::text) AS color,
    CASE WHEN e.is_done THEN 'hecho'::text ELSE 'pendiente'::text END AS estado,
    true AS editable, e.linked_administracion_id AS linked_admin_id,
    NULL::uuid AS linked_consorcio_id
   FROM agenda_events e
     LEFT JOIN agenda_categories c ON c.id = e.category_id
UNION ALL
 SELECT 'vencimiento'::text AS fuente, v.id AS origen_id, NULL::uuid AS owner_id,
    'Vencimiento: '::text ||
        CASE v.tipo
            WHEN 'matricula_rpac'::text THEN 'Matrícula RPAC'::text
            WHEN 'renovacion_rpac'::text THEN 'Matrícula RPAC'::text
            WHEN 'ddjj_anual'::text THEN 'DDJJ Anual'::text
            WHEN 'curso_actualizacion'::text THEN 'Curso de actualización'::text
            WHEN 'curso_rpa_caba'::text THEN 'Actualización RPA (CABA)'::text
            WHEN 'certificado_arca'::text THEN 'Certificado ARCA'::text
            WHEN 'seguro_consorcio'::text THEN 'Seguro del consorcio'::text
            WHEN 'habilitacion_municipal'::text THEN 'Habilitación municipal'::text
            WHEN 'libro_actas'::text THEN 'Libro de actas'::text
            WHEN 'libro_administracion'::text THEN 'Libro de administración'::text
            WHEN 'revision_ascensor'::text THEN 'Revisión de ascensor'::text
            ELSE 'Otro'::text
        END AS title,
    v.fecha_vencimiento::timestamp with time zone + '09:00:00'::interval AS start_at,
    v.fecha_vencimiento::timestamp with time zone + '10:00:00'::interval AS end_at,
    true AS all_day, 'vencimiento'::text AS category_hint, '#f59e0b'::text AS color,
    v.estado, false AS editable,
    v.administracion_id AS linked_admin_id, v.consorcio_id AS linked_consorcio_id
   FROM vencimientos v
  WHERE v.estado = ANY (ARRAY['vigente'::text, 'vencido'::text])
    AND COALESCE(v.origen, '') <> 'declarado'  -- DGG-248 E-GG-270: declarado es client-only
UNION ALL
 SELECT 'tramite'::text AS fuente, t.id AS origen_id, NULL::uuid AS owner_id,
    t.titulo AS title, t.vence_at AS start_at, t.vence_at + '00:30:00'::interval AS end_at,
    false AS all_day, 'tramite'::text AS category_hint, '#8b5cf6'::text AS color,
    t.estado, false AS editable,
    t.administracion_id AS linked_admin_id, t.consorcio_id AS linked_consorcio_id
   FROM tramites t
  WHERE t.vence_at IS NOT NULL AND (t.estado <> ALL (ARRAY['cerrado'::text, 'cancelado'::text]))
UNION ALL
 SELECT 'comprobante'::text AS fuente, cp.id AS origen_id, NULL::uuid AS owner_id,
    (((('Cobranza: '::text || cp.tipo) || ' '::text) || lpad(cp.punto_venta::text, 5, '0'::text)) || '-'::text) || COALESCE(lpad(cp.numero::text, 8, '0'::text), '—'::text) AS title,
    cp.vencimiento::timestamp with time zone + '09:00:00'::interval AS start_at,
    cp.vencimiento::timestamp with time zone + '10:00:00'::interval AS end_at,
    true AS all_day, 'comprobante'::text AS category_hint, '#ef4444'::text AS color,
    cp.estado_cobranza AS estado, false AS editable,
    cp.administracion_id AS linked_admin_id, cp.consorcio_id AS linked_consorcio_id
   FROM comprobantes cp
  WHERE cp.vencimiento IS NOT NULL AND cp.estado_cobranza <> 'pagado'::text
UNION ALL
 SELECT 'solicitud'::text AS fuente, s.id AS origen_id, NULL::uuid AS owner_id,
    COALESCE('Solicitud: '::text || NULLIF(s.servicio_slug, ''::text), 'Solicitud nueva'::text) AS title,
    s.created_at AS start_at, s.created_at + '00:30:00'::interval AS end_at,
    false AS all_day, 'solicitud'::text AS category_hint, '#06b6d4'::text AS color,
    s.estado, false AS editable,
    s.cliente_id AS linked_admin_id, NULL::uuid AS linked_consorcio_id
   FROM solicitudes s
  WHERE s.estado <> ALL (ARRAY['activada'::text, 'descartada'::text])
UNION ALL
 SELECT 'tracking_alarma'::text AS fuente, t.id AS origen_id, NULL::uuid AS owner_id,
    'Seguimiento: '::text || COALESCE(NULLIF(t.titulo, ''::text), t.codigo) AS title,
    tl.alerta_en AS start_at, tl.alerta_en + '00:30:00'::interval AS end_at,
    false AS all_day, 'tracking_alarma'::text AS category_hint, '#dc2626'::text AS color,
    CASE WHEN tl.alerta_en < now() THEN 'vencida'::text ELSE 'pendiente'::text END AS estado,
    false AS editable, t.administracion_id AS linked_admin_id, NULL::uuid AS linked_consorcio_id
   FROM tracking_lineas tl
     JOIN tramites t ON t.id = tl.tramite_id
  WHERE tl.alerta_en IS NOT NULL AND (t.estado <> ALL (ARRAY['resuelto'::text, 'cerrado'::text, 'cancelado'::text]));

-- ── E-GG-271 · kpis_dashboard_global: el contador cuadra con la grilla.
CREATE OR REPLACE FUNCTION public.kpis_dashboard_global(p_desde date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_result jsonb; v_facturado_periodo numeric; v_cobrado_periodo numeric;
  v_deuda_total numeric; v_admins_morosos int; v_tramites_abiertos int;
  v_vencimientos_proximos int; v_serie jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(SUM(total),0) INTO v_facturado_periodo
    FROM comprobantes WHERE estado='autorizado' AND fecha >= p_desde;
  SELECT COALESCE(SUM(mi.monto_imputado),0) INTO v_cobrado_periodo
    FROM movimiento_imputaciones mi JOIN movimientos m ON m.id=mi.movimiento_id
   WHERE m.fecha >= p_desde AND m.tipo='ingreso' AND m.estado <> 'anulado';
  WITH deudas AS (
    SELECT administracion_id AS aid, SUM(saldo_pendiente) AS deuda
    FROM comprobantes WHERE saldo_pendiente>0 AND estado NOT IN ('anulado','borrador')
    GROUP BY administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado,0)) AS credito
    FROM movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM movimiento_imputaciones mi
       WHERE mi.movimiento_id=m.id AND mi.comprobante_id IS NOT NULL) imp ON true
    WHERE m.administracion_id IS NOT NULL AND m.tipo='ingreso'
      AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado,0)) > 0.001
    GROUP BY m.administracion_id
  ),
  neto AS (
    SELECT d.aid, (d.deuda - COALESCE(cr.credito,0)) AS deuda_neta
    FROM deudas d LEFT JOIN creditos cr ON cr.aid=d.aid
  )
  SELECT COALESCE(SUM(deuda_neta) FILTER (WHERE deuda_neta>0),0),
         COUNT(*) FILTER (WHERE deuda_neta>0)
    INTO v_deuda_total, v_admins_morosos FROM neto;
  SELECT COUNT(*) INTO v_tramites_abiertos
    FROM tramites WHERE estado IN ('abierto','en_progreso','esperando_cliente');
  -- DGG-248 E-GG-271: excluir declarado (client-only) para cuadrar con la grilla
  -- proximos_vencimientos y el ProximosVencimientosWidget del mismo home.
  SELECT COUNT(*) INTO v_vencimientos_proximos
    FROM vencimientos WHERE estado='vigente'
     AND COALESCE(origen,'') <> 'declarado'
     AND fecha_vencimiento >= current_date AND fecha_vencimiento <= current_date + interval '30 days';
  SELECT jsonb_agg(jsonb_build_object('fecha',d,'facturado',COALESCE(daily,0)) ORDER BY d)
    INTO v_serie
    FROM (SELECT gs::date AS d,
            (SELECT COALESCE(SUM(total),0) FROM comprobantes WHERE estado='autorizado' AND fecha=gs::date) AS daily
          FROM generate_series(p_desde, current_date, interval '1 day') gs) src;
  v_result := jsonb_build_object(
    'facturado_periodo', v_facturado_periodo, 'cobrado_periodo', v_cobrado_periodo,
    'deuda_total', v_deuda_total, 'admins_morosos', v_admins_morosos,
    'tramites_abiertos', v_tramites_abiertos, 'vencimientos_proximos', v_vencimientos_proximos,
    'serie_facturado', COALESCE(v_serie,'[]'::jsonb));
  RETURN v_result;
END;
$function$;

-- ── E-GG-272 · busqueda_global: el bloque de vencimientos excluye declarado.
CREATE OR REPLACE FUNCTION public.busqueda_global(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id uuid, titulo text, subtitulo text, url_path text, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    AND COALESCE(v.origen,'') <> 'declarado'  -- DGG-248 E-GG-272: coherente con la grilla de gerencia
    AND (v_is_staff OR v.administracion_id = v_adm)
  ORDER BY rank DESC LIMIT p_limit;

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

  IF v_is_staff THEN
    RETURN QUERY
    SELECT 'curso'::text, cu.id, cu.titulo, COALESCE(cu.modalidad, '—'),
      '/gerencia/campus/' || cu.id::text, similarity(lower(cu.titulo), q)::real
    FROM cursos cu
    WHERE lower(cu.titulo) LIKE qlike
    ORDER BY rank DESC LIMIT p_limit;
  END IF;

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
$function$;

-- ── E-GG-273 · marcar_renovado: reordenar para no dejar 2 'vigente' un instante
--    (habilita el índice único de abajo sin romper la renovación manual).
CREATE OR REPLACE FUNCTION public.marcar_renovado(p_vencimiento_id uuid, p_nueva_fecha_vencimiento date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_old record;
  v_new_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede renovar vencimientos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.vencimientos WHERE id = p_vencimiento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vencimiento no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_nueva_fecha_vencimiento <= v_old.fecha_vencimiento THEN
    RAISE EXCEPTION 'La nueva fecha debe ser posterior a la actual'
      USING ERRCODE = '22023';
  END IF;

  -- DGG-248 E-GG-273: primero retiramos el viejo (sale del predicado del índice),
  -- después insertamos el nuevo vigente — nunca 2 activos simultáneos.
  UPDATE public.vencimientos
     SET estado = 'renovado', updated_at = now()
   WHERE id = p_vencimiento_id;

  INSERT INTO public.vencimientos (
    tipo, sujeto, sujeto_id,
    administracion_id, consorcio_id,
    fecha_vencimiento, fecha_emision,
    descripcion, observaciones,
    estado, renovado_por, origen
  )
  VALUES (
    v_old.tipo, v_old.sujeto, v_old.sujeto_id,
    v_old.administracion_id, v_old.consorcio_id,
    p_nueva_fecha_vencimiento, CURRENT_DATE,
    v_old.descripcion, v_old.observaciones,
    'vigente', v_old.id, v_old.origen
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

-- ── E-GG-273 · índice único parcial: 1 sola fila declarada activa por (admin,tipo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_venc_declarado_activo
  ON public.vencimientos (administracion_id, tipo)
  WHERE origen = 'declarado' AND estado IN ('vigente','vencido');
