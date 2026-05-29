-- ============================================================================
-- Migration: 0122_fix_agenda_alarma_origen_tramite
-- Fecha: 2026-05-28
-- Fix navegación alarma: origen_id debe ser tramite_id, no linea_id, para
-- que /gerencia/trackings/${origenId} abra el tracking correcto al hacer
-- click sobre el evento en la Agenda.
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_agenda_unificada AS
 SELECT 'personal'::text AS fuente, e.id AS origen_id, e.owner_id, e.title,
    e.start_at, e.end_at, e.all_day, 'personal'::text AS category_hint,
    COALESCE(e.color_override, c.color, '#06b6d4'::text) AS color,
    CASE WHEN e.is_done THEN 'hecho' ELSE 'pendiente' END AS estado,
    true AS editable, e.linked_administracion_id AS linked_admin_id,
    NULL::uuid AS linked_consorcio_id
   FROM public.agenda_events e
   LEFT JOIN public.agenda_categories c ON c.id = e.category_id
UNION ALL
 SELECT 'vencimiento', v.id, NULL::uuid,
    'Vencimiento: ' || CASE v.tipo
        WHEN 'matricula_rpac' THEN 'Matrícula RPAC'
        WHEN 'ddjj_anual' THEN 'DDJJ Anual'
        WHEN 'certificado_arca' THEN 'Certificado ARCA'
        WHEN 'seguro_consorcio' THEN 'Seguro del consorcio'
        WHEN 'habilitacion_municipal' THEN 'Habilitación municipal'
        WHEN 'libro_actas' THEN 'Libro de actas'
        WHEN 'libro_administracion' THEN 'Libro de administración'
        WHEN 'revision_ascensor' THEN 'Revisión de ascensor'
        ELSE 'Otro' END,
    v.fecha_vencimiento::timestamptz + '09:00:00'::interval,
    v.fecha_vencimiento::timestamptz + '10:00:00'::interval,
    true, 'vencimiento', '#f59e0b', v.estado, false,
    v.administracion_id, v.consorcio_id
   FROM public.vencimientos v WHERE v.estado IN ('vigente','vencido')
UNION ALL
 SELECT 'tramite', t.id, NULL::uuid, t.titulo,
    t.vence_at, t.vence_at + '00:30:00'::interval,
    false, 'tramite', '#8b5cf6', t.estado, false,
    t.administracion_id, t.consorcio_id
   FROM public.tramites t WHERE t.vence_at IS NOT NULL AND t.estado NOT IN ('cerrado','cancelado')
UNION ALL
 SELECT 'comprobante', cp.id, NULL::uuid,
    'Cobranza: ' || cp.tipo || ' ' || lpad(cp.punto_venta::text, 5, '0') || '-' ||
        COALESCE(lpad(cp.numero::text, 8, '0'), '—'),
    cp.vencimiento::timestamptz + '09:00:00'::interval,
    cp.vencimiento::timestamptz + '10:00:00'::interval,
    true, 'comprobante', '#ef4444', cp.estado_cobranza, false,
    cp.administracion_id, cp.consorcio_id
   FROM public.comprobantes cp WHERE cp.vencimiento IS NOT NULL AND cp.estado_cobranza <> 'pagado'
UNION ALL
 SELECT 'solicitud', s.id, NULL::uuid,
    COALESCE('Solicitud: ' || NULLIF(s.servicio_slug, ''), 'Solicitud nueva'),
    s.created_at, s.created_at + '00:30:00'::interval,
    false, 'solicitud', '#06b6d4', s.estado, false,
    s.cliente_id, NULL::uuid
   FROM public.solicitudes s WHERE s.estado NOT IN ('activada','descartada')
UNION ALL
 -- FIX: origen_id = t.id (tramite_id) en vez de tl.id (linea_id)
 -- para que el click navegue directo al tracking del trámite.
 SELECT 'tracking_alarma', t.id AS origen_id, NULL::uuid,
    'Seguimiento: ' || COALESCE(NULLIF(t.titulo, ''), t.codigo),
    tl.alerta_en, tl.alerta_en + '00:30:00'::interval,
    false, 'tracking_alarma', '#dc2626',
    CASE WHEN tl.alerta_en < now() THEN 'vencida' ELSE 'pendiente' END,
    false, t.administracion_id, NULL::uuid
   FROM public.tracking_lineas tl
   JOIN public.tramites t ON t.id = tl.tramite_id
  WHERE tl.alerta_en IS NOT NULL
    AND t.estado NOT IN ('resuelto','cerrado','cancelado');
