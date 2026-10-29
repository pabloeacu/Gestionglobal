-- 0609_dgg234_f4b_plantillas_jurisdiccion.sql
-- DGG-234 · Fase 4b — Plantillas de email de matrícula por jurisdicción.
-- Ver knowledge-base/DGG-234_matricula_multijurisdiccion.md §5 (F4).
-- --------------------------------------------------------------------------
-- El edge dispatch-vencimientos (mismo chunk) rutea el recordatorio de
-- matrícula declarada por jurisdicción:
--   · pba     -> vencimiento-declarado-cliente (genérica declarada)
--   · caba    -> vencimiento-matricula-caba     (NUEVA, ofrece el curso GG)
--   · neuquen -> aviso-matricula-neuquen        (NUEVA, sólo aviso)
-- Además saca la línea PBA-only ("cargá tu legajo RPAC … registro oficial")
-- de la genérica y la convierte en la variable {{nota_verificacion}} (texto),
-- que el edge rellena según jurisdicción. Así la genérica queda correcta para
-- CUALQUIER declarado no-matrícula (ddjj/curso/certificado) de CABA/NEU, no
-- sólo PBA (barrido §6-2bis (b) estado×superficie).
-- NADA en PBA cambia de contenido: para pba el edge pasa exactamente la misma
-- frase que estaba hardcodeada. Plantillas = data; no requieren redeploy de
-- dispatch-emails (las lee en runtime).
-- --------------------------------------------------------------------------

-- 1) Genérica declarada: la 3ª línea (legajo RPAC) pasa a variable de texto.
UPDATE public.email_templates
SET cuerpo_html_visual = replace(
      cuerpo_html_visual,
      'Además, si cargás tu legajo RPAC en tu ficha, verificamos tu matrícula con el registro oficial.',
      '{{nota_verificacion}}'),
    variables = '["nombre","tipo_label","fecha_vencimiento","frase_estado","nota_verificacion"]'::jsonb,
    updated_at = now()
WHERE slug = 'vencimiento-declarado-cliente';

-- 2) NUEVA · recordatorio de matrícula RPA (CABA) — voz "según tus datos" +
--    oferta del curso de actualización anual (lo dicta Gestión Global).
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, body_text, from_casilla, reply_to,
   descripcion, activo, variables, kicker, titulo_visual, color_acento,
   mostrar_logo, cuerpo_html_visual, firma, incluir_tabla_envio, cta_text,
   cta_url, layout_version)
VALUES (
  'vencimiento-matricula-caba',
  'Vencimiento matrícula RPA (CABA) — declarado',
  'Recordatorio: tu matrícula RPA (CABA) · Gestión Global',
  '<!-- manaxer-v1 -->',
  NULL,
  'general',
  NULL,
  'DGG-234 F4b · recordatorio de renovación de matrícula CABA (dato declarado por el cliente). Ofrece el curso de actualización anual de Gestión Global.',
  true,
  '["nombre","fecha_vencimiento","frase_estado"]'::jsonb,
  'SEGÚN TUS DATOS',
  'Tu matrícula RPA (CABA) está por vencer, {{nombre}}',
  '#0891b2',
  true,
  '<p style="margin:0 0 12px;color:#1e293b;">Según los datos que cargaste en tu perfil, {{frase_estado}}.</p>'
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">En CABA la inscripción se mantiene al día con el <strong>curso de actualización anual</strong>, que dictamos en Gestión Global. Reservá tu lugar en la próxima cohorte y llegá sin apuros.</p>'
  '<p style="margin:0;color:#475569;font-size:14px;">Si ya la renovaste, actualizá la fecha en tu ficha y dejamos de recordártela.</p>',
  'Equipo Gestión Global',
  false,
  'Ver el curso de actualización',
  'https://gestionglobal.ar/formulario/curso-actualizacion-caba?origen=aviso',
  'manaxer-v1'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, descripcion = EXCLUDED.descripcion,
  variables = EXCLUDED.variables, kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual, color_acento = EXCLUDED.color_acento,
  mostrar_logo = EXCLUDED.mostrar_logo, cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  firma = EXCLUDED.firma, incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  cta_text = EXCLUDED.cta_text, cta_url = EXCLUDED.cta_url,
  from_casilla = EXCLUDED.from_casilla, layout_version = EXCLUDED.layout_version,
  activo = true, updated_at = now();

-- 3) NUEVA · aviso de matrícula RPA (Neuquén) — SÓLO aviso (sin curso ni
--    gestoría: no hay convenio ni gestoría en Neuquén). CTA a la ficha.
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, body_text, from_casilla, reply_to,
   descripcion, activo, variables, kicker, titulo_visual, color_acento,
   mostrar_logo, cuerpo_html_visual, firma, incluir_tabla_envio, cta_text,
   cta_url, layout_version)
VALUES (
  'aviso-matricula-neuquen',
  'Aviso matrícula RPA (Neuquén) — declarado',
  'Recordatorio: tu matrícula RPA (Neuquén) · Gestión Global',
  '<!-- manaxer-v1 -->',
  NULL,
  'general',
  NULL,
  'DGG-234 F4b · recordatorio de renovación de matrícula Neuquén (dato declarado). Sólo aviso — Neuquén no tiene curso ni gestoría contratables.',
  true,
  '["nombre","fecha_vencimiento","frase_estado"]'::jsonb,
  'SEGÚN TUS DATOS',
  'Tu matrícula RPA (Neuquén) está por vencer, {{nombre}}',
  '#0891b2',
  true,
  '<p style="margin:0 0 12px;color:#1e293b;">Según los datos que cargaste en tu perfil, {{frase_estado}}.</p>'
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Te lo recordamos para que la renueves a tiempo ante el RPA de Neuquén y no quede inhabilitada.</p>'
  '<p style="margin:0;color:#475569;font-size:14px;">Si ya la renovaste, actualizá la fecha en tu ficha y dejamos de recordártela.</p>',
  'Equipo Gestión Global',
  false,
  'Ver mi ficha',
  'https://gestionglobal.ar/portal/mi-ficha?origen=aviso',
  'manaxer-v1'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, descripcion = EXCLUDED.descripcion,
  variables = EXCLUDED.variables, kicker = EXCLUDED.kicker,
  titulo_visual = EXCLUDED.titulo_visual, color_acento = EXCLUDED.color_acento,
  mostrar_logo = EXCLUDED.mostrar_logo, cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  firma = EXCLUDED.firma, incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  cta_text = EXCLUDED.cta_text, cta_url = EXCLUDED.cta_url,
  from_casilla = EXCLUDED.from_casilla, layout_version = EXCLUDED.layout_version,
  activo = true, updated_at = now();
