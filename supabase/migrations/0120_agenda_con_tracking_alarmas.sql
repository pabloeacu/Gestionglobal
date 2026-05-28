-- ============================================================================
-- Migration: 0120_agenda_con_tracking_alarmas
-- Fecha: 2026-05-28
-- DGG-XX · Bloque A · Fase 2 (parte 1)
-- Agregar fuente 'tracking_alarma' a vw_agenda_unificada para que el
-- calendario muestre las alarmas de tracking junto a vencimientos,
-- comprobantes, etc.
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_agenda_unificada AS
 SELECT 'personal'::text AS fuente,
    e.id AS origen_id,
    e.owner_id, e.title, e.start_at, e.end_at, e.all_day,
    'personal'::text AS category_hint,
    COALESCE(e.color_override, c.color, '#06b6d4'::text) AS color,
    CASE WHEN e.is_done THEN 'hecho'::text ELSE 'pendiente'::text END AS estado,
    true AS editable,
    e.linked_administracion_id AS linked_admin_id,
    NULL::uuid AS linked_consorcio_id
   FROM public.agenda_events e
   LEFT JOIN public.agenda_categories c ON c.id = e.category_id
UNION ALL
 SELECT 'vencimiento'::text AS fuente, v.id AS origen_id, NULL::uuid AS owner_id,
    'Vencimiento: ' ||
        CASE v.tipo
            WHEN 'matricula_rpac' THEN 'Matrícula RPAC'
            WHEN 'ddjj_anual' THEN 'DDJJ Anual'
            WHEN 'certificado_arca' THEN 'Certificado ARCA'
            WHEN 'seguro_consorcio' THEN 'Seguro del consorcio'
            WHEN 'habilitacion_municipal' THEN 'Habilitación municipal'
            WHEN 'libro_actas' THEN 'Libro de actas'
            WHEN 'libro_administracion' THEN 'Libro de administración'
            WHEN 'revision_ascensor' THEN 'Revisión de ascensor'
            ELSE 'Otro'
        END AS title,
    v.fecha_vencimiento::timestamptz + '09:00:00'::interval AS start_at,
    v.fecha_vencimiento::timestamptz + '10:00:00'::interval AS end_at,
    true AS all_day, 'vencimiento'::text AS category_hint,
    '#f59e0b'::text AS color, v.estado, false AS editable,
    v.administracion_id AS linked_admin_id, v.consorcio_id AS linked_consorcio_id
   FROM public.vencimientos v
  WHERE v.estado = ANY (ARRAY['vigente'::text, 'vencido'::text])
UNION ALL
 SELECT 'tramite'::text AS fuente, t.id AS origen_id, NULL::uuid AS owner_id,
    t.titulo AS title, t.vence_at AS start_at,
    t.vence_at + '00:30:00'::interval AS end_at,
    false AS all_day, 'tramite'::text AS category_hint,
    '#8b5cf6'::text AS color, t.estado, false AS editable,
    t.administracion_id AS linked_admin_id, t.consorcio_id AS linked_consorcio_id
   FROM public.tramites t
  WHERE t.vence_at IS NOT NULL AND (t.estado <> ALL (ARRAY['cerrado'::text, 'cancelado'::text]))
UNION ALL
 SELECT 'comprobante'::text AS fuente, cp.id AS origen_id, NULL::uuid AS owner_id,
    'Cobranza: ' || cp.tipo || ' ' || lpad(cp.punto_venta::text, 5, '0') || '-' ||
        COALESCE(lpad(cp.numero::text, 8, '0'), '—') AS title,
    cp.vencimiento::timestamptz + '09:00:00'::interval AS start_at,
    cp.vencimiento::timestamptz + '10:00:00'::interval AS end_at,
    true AS all_day, 'comprobante'::text AS category_hint,
    '#ef4444'::text AS color, cp.estado_cobranza AS estado, false AS editable,
    cp.administracion_id AS linked_admin_id, cp.consorcio_id AS linked_consorcio_id
   FROM public.comprobantes cp
  WHERE cp.vencimiento IS NOT NULL AND cp.estado_cobranza <> 'pagado'::text
UNION ALL
 SELECT 'solicitud'::text AS fuente, s.id AS origen_id, NULL::uuid AS owner_id,
    COALESCE('Solicitud: ' || NULLIF(s.servicio_slug, ''), 'Solicitud nueva') AS title,
    s.created_at AS start_at, s.created_at + '00:30:00'::interval AS end_at,
    false AS all_day, 'solicitud'::text AS category_hint,
    '#06b6d4'::text AS color, s.estado, false AS editable,
    s.cliente_id AS linked_admin_id, NULL::uuid AS linked_consorcio_id
   FROM public.solicitudes s
  WHERE s.estado <> ALL (ARRAY['activada'::text, 'descartada'::text])
UNION ALL
 -- Nueva fuente: alarmas de tracking
 SELECT 'tracking_alarma'::text AS fuente,
    tl.id AS origen_id, NULL::uuid AS owner_id,
    'Seguimiento: ' || COALESCE(NULLIF(t.titulo, ''), t.codigo) AS title,
    tl.alerta_en AS start_at,
    tl.alerta_en + '00:30:00'::interval AS end_at,
    false AS all_day, 'tracking_alarma'::text AS category_hint,
    '#dc2626'::text AS color,
    CASE WHEN tl.alerta_en < now() THEN 'vencida'::text ELSE 'pendiente'::text END AS estado,
    false AS editable,
    t.administracion_id AS linked_admin_id,
    NULL::uuid AS linked_consorcio_id
   FROM public.tracking_lineas tl
   JOIN public.tramites t ON t.id = tl.tramite_id
  WHERE tl.alerta_en IS NOT NULL
    AND t.estado NOT IN ('resuelto','cerrado','cancelado');
