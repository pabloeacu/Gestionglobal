-- 0754 · DGG-275 F5 · Mail "presentación realizada" DDJJ (base INERTE)
-- ----------------------------------------------------------------------------
-- (A) Helper SQL que calcula el resumen ESCALAR de la presentación de un
--     trámite DDJJ: cantidad de comprobantes + importe total (numérico y
--     formateado $). Lee TODO el lote vía el vínculo N:1 de F3
--     (comprobantes.tramite_id, mig 0749) + el comprobante_id del trámite
--     (compat. con DDJJ facturadas antes de F3), excluyendo anulados.
-- (B) Plantilla premium `ddjj-presentacion-realizada` (manaxer-v1) con el
--     resumen escalar "se generaron {{cantidad}} comprobantes por un total de
--     {{importe_total}}" (M2: el motor renderVars sólo sustituye escalares).
--
-- INERTE a propósito: NO wirea ningún envío. El disparo (botón de gerencia /
-- al resolver / al facturar) y el gateo (flag ddjj_avisos_habilitados, F6 OFF)
-- quedan pendientes de la decisión de Pablo. El genérico `tramite-resuelto` no
-- está wireado en prod (hoy el cliente se entera por líneas visibles →
-- tracking-recordatorio), así que no hay un envío previo que "reemplazar".

-- ── (A) Helper de resumen escalar ──
CREATE OR REPLACE FUNCTION public.tramite_ddjj_resumen_comprobantes(p_tramite_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH comps AS (
    SELECT c.id, c.total
    FROM public.comprobantes c
    WHERE c.estado <> 'anulado'
      AND (
        c.tramite_id = p_tramite_id
        OR c.id = (SELECT t.comprobante_id FROM public.tramites t WHERE t.id = p_tramite_id)
      )
  ), agg AS (
    SELECT count(*)::int AS cantidad, coalesce(sum(total), 0)::numeric(14,2) AS importe_total
    FROM comps
  )
  SELECT jsonb_build_object(
    'cantidad', cantidad,
    'importe_total', importe_total,
    -- Formato AR locale-INDEPENDIENTE ($1.234.567,89): el servidor corre en
    -- locale C (to_char con G/D da formato US "54,000.00"); acá forzamos miles
    -- con punto y decimales con coma sin depender de lc_numeric. (Los mails SQL
    -- legacy de la plataforma usan el patrón US crudo — inconsistencia flaggeada.)
    'importe_total_fmt',
      '$'
      || regexp_replace(to_char(floor(importe_total)::numeric, 'FM999,999,999,990'), ',', '.', 'g')
      || ','
      || lpad((round((importe_total - floor(importe_total)) * 100))::int::text, 2, '0')
  )
  FROM agg;
$$;

COMMENT ON FUNCTION public.tramite_ddjj_resumen_comprobantes(uuid)
  IS 'DGG-275 F5 · Resumen escalar de la presentación DDJJ de un trámite {cantidad, importe_total, importe_total_fmt}. Lee todo el lote (comprobantes.tramite_id + comprobante_id del trámite), excluye anulados. Para la plantilla ddjj-presentacion-realizada.';

-- ── (B) Plantilla premium (upsert idempotente) ──
INSERT INTO public.email_templates (
  slug, nombre, asunto, kicker, titulo_visual, color_acento, mostrar_logo,
  body_html, cuerpo_html_visual,
  firma, cta_text, cta_url, variables, layout_version, from_casilla, incluir_tabla_envio, activo
) VALUES (
  'ddjj-presentacion-realizada',
  'DDJJ · Presentación realizada',
  'Tu declaración jurada {{periodo}} fue presentada ante el RPAC',
  'DECLARACIÓN JURADA',
  'Tu DDJJ fue presentada ante el RPAC',
  '#0891b2',
  true,
  -- body_html: fallback plano legacy (NOT NULL); el render real usa cuerpo_html_visual (manaxer-v1)
  '<p>Hola {{nombre}},</p><p>Ya presentamos ante el RPAC tu declaración jurada del período {{periodo}}.</p><p>Se generaron {{cantidad}} comprobante(s) por un total de {{importe_total}}.</p><p>Podés ver el detalle y tu cuenta en el portal: {{link_portal}}</p><p>Equipo Gestión Global</p>',
  '<h2>Presentamos tu declaración jurada</h2>'
  || '<p>Hola {{nombre}}, ya presentamos ante el RPAC tu declaración jurada correspondiente al período <strong>{{periodo}}</strong>. Queda registrada y podés seguir su estado desde tu portal.</p>'
  || '<table role="presentation" width="100%" style="border-collapse:collapse;margin:20px 0;"><tr>'
  || '<td style="padding:16px;background:#f3f7fb;border:1px solid rgba(11,31,51,.12);border-radius:10px;">'
  || '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d7284;font-weight:600;">Resumen de la presentación</div>'
  || '<div style="margin-top:8px;font-size:15px;color:#122230;">Se generaron <strong>{{cantidad}}</strong> comprobante(s) por un total de <strong>{{importe_total}}</strong>.</div>'
  || '</td></tr></table>'
  || '<p>El detalle de los comprobantes y el estado de tu cuenta están disponibles en tu portal. Ante cualquier consulta, respondé este correo y te ayudamos.</p>',
  'Equipo Gestión Global',
  'Ver mi cuenta',
  '{{link_portal}}',
  '["nombre","periodo","cantidad","importe_total","link_portal"]'::jsonb,
  'manaxer-v1',
  'general',
  false,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  asunto = EXCLUDED.asunto,
  body_html = EXCLUDED.body_html,
  kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual,
  color_acento = EXCLUDED.color_acento,
  mostrar_logo = EXCLUDED.mostrar_logo,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  firma = EXCLUDED.firma,
  cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url,
  variables = EXCLUDED.variables,
  layout_version = EXCLUDED.layout_version,
  from_casilla = EXCLUDED.from_casilla,
  incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  activo = EXCLUDED.activo,
  updated_at = now();
