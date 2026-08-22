-- 0443_dgg142e4_f2_plantillas_ofrecimientos.sql
-- DGG-142 · Etapa 4 · F2 — Plantillas de email de OFRECIMIENTO por servicio
-- (matriz DGG-143). Antes existía UNA sola plantilla genérica de recordatorio
-- (`vencimiento_alerta_cliente`); ahora cada servicio tiene la suya, con CTA
-- directo a su formulario público. Layout manaxer-v1 → editables por gerencia
-- en Configuración → Plantillas email SIN tocar código (el copy es seed
-- inicial mío; Pablo/JL lo retocan cuando quieran).
-- ON CONFLICT DO NOTHING: re-aplicar jamás pisa ediciones de gerencia.

INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, activo, kicker, titulo_visual,
   color_acento, mostrar_logo, cuerpo_html_visual, firma, layout_version,
   cta_text, cta_url, descripcion, variables)
VALUES
(
  'ofrecimiento-rpac-renovacion',
  'Ofrecimiento · Renovación de matrícula RPAC',
  'Tu matrícula RPAC vence en {{dias_restantes}} días · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'RENOVACIÓN DE MATRÍCULA',
  'Tu matrícula vence pronto, {{nombre}}',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Tu matrícula RPAC vence el <strong>{{fecha_vencimiento}}</strong> — quedan <strong>{{dias_restantes}} días</strong>.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Iniciá la renovación ahora y nosotros nos ocupamos de todo el trámite ante el RPAC: documentación, presentación y seguimiento hasta la constancia final.</p>' ||
  '<p style="margin:0;color:#1e293b;">Renovar a tiempo te evita quedar inhabilitado para ejercer. Cualquier duda, respondé este correo.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Iniciar renovación', 'https://gestionglobal.ar/formulario/renovacion-rpac?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: 45/30/15 días antes del vencimiento de matrícula RPAC.',
  '["nombre","dias_restantes","fecha_vencimiento"]'::jsonb
),
(
  'ofrecimiento-rpac-certificado',
  'Ofrecimiento · Certificado de acreditación RPAC',
  '¿Necesitás acreditar tu matrícula? Certificado RPAC al día · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'ACREDITACIÓN VIGENTE',
  'Tu certificado RPAC, listo cuando lo necesites',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Hola {{nombre}}: para asambleas, consorcios nuevos o cualquier entidad que lo requiera, el <strong>certificado de acreditación RPAC</strong> es tu comprobante oficial de matrícula activa.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Lo gestionamos por vos: pedilo hoy y lo recibís sin moverte de tu administración.</p>' ||
  '<p style="margin:0;color:#1e293b;">Tener uno reciente a mano siempre suma frente a tus consorcios.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Solicitar certificado', 'https://gestionglobal.ar/formulario/certificado-rpac?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: cada 90 días móviles a clientes RPAC que no contrataron uno en ese período.',
  '["nombre"]'::jsonb
),
(
  'ofrecimiento-consultoria-juridica',
  'Ofrecimiento · Consultoría jurídica',
  '¿Dudas legales en tu administración? Estamos para ayudarte · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'CONSULTORÍA JURÍDICA',
  'Una consulta a tiempo evita un problema grande',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Hola {{nombre}}: la administración de consorcios trae dudas legales todo el tiempo — reglamentos, deudores, asambleas, contratos, despidos.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Nuestro servicio de <strong>consultoría jurídica</strong> te da respuesta profesional y por escrito para tus casos concretos.</p>' ||
  '<p style="margin:0;color:#1e293b;">Contanos tu caso y te decimos cómo encararlo.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Hacer mi consulta', 'https://gestionglobal.ar/formulario/consultoria-juridica?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: cada 120 días (incluye clientes SOLO-CABA).',
  '["nombre"]'::jsonb
),
(
  'ofrecimiento-curso-actualizacion-rpac',
  'Ofrecimiento · Curso de Actualización RPAC (PBA)',
  'Tu actualización anual RPAC: reservá tu lugar · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'CAPACITACIÓN OBLIGATORIA',
  'Mantené tu matrícula al día, {{nombre}}',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">El <strong>Curso de Actualización RPAC</strong> es requisito anual para mantener tu matrícula vigente en la Provincia de Buenos Aires.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Cursás online en nuestro campus, a tu ritmo, con encuentros en vivo y certificado al finalizar. Al aprobarlo, tu renovación sale sola.</p>' ||
  '<p style="margin:0;color:#1e293b;">Los cupos de cada cohorte son limitados — asegurá el tuyo.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Inscribirme al curso', 'https://gestionglobal.ar/formulario/curso-actualizacion?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: cada 60 días a clientes RPAC que no renovaron matrícula en esos 60 días ni hicieron el curso en los últimos 12 meses móviles.',
  '["nombre"]'::jsonb
),
(
  'ofrecimiento-ddjj',
  'Ofrecimiento · Declaración Jurada anual',
  'Tu DDJJ anual vence en marzo: hacela con nosotros · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'OBLIGACIÓN ANUAL',
  'La DDJJ no espera, {{nombre}}',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">En <strong>marzo</strong> vence la presentación de la Declaración Jurada anual ante el RPAC — obligatoria para todos los administradores matriculados.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'La preparamos y presentamos por vos: vos mandás la información, nosotros nos ocupamos del resto y te avisamos cuando está presentada.</p>' ||
  '<p style="margin:0;color:#1e293b;">Arrancarla temprano te evita el embudo de febrero-marzo.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Iniciar mi DDJJ', 'https://gestionglobal.ar/formulario/ddjj-anual?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: noviembre a marzo, un toque cada 30 días, salvo clientes que ya la contrataron en el ciclo.',
  '["nombre"]'::jsonb
),
(
  'ofrecimiento-rpa-caba',
  'Ofrecimiento · Curso de Actualización RPA (CABA)',
  'Se acerca tu actualización anual RPA (CABA) · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'ACTUALIZACIÓN CABA',
  'Tu aniversario de curso se acerca, {{nombre}}',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Hiciste con nosotros el <strong>Curso de Actualización RPA (CABA)</strong> hace casi un año — y la actualización es anual para mantener tu inscripción al día.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  'Faltan <strong>{{dias_restantes}} días</strong> para tu aniversario. Reservá tu lugar en la próxima cohorte y llegá sin apuros.</p>' ||
  '<p style="margin:0;color:#1e293b;">Mismo campus, misma modalidad que ya conocés.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Reservar mi lugar', 'https://gestionglobal.ar/formulario/curso-actualizacion-caba?origen=ofrecimiento',
  'Motor de ofrecimientos DGG-143: 30/15/día del aniversario del curso anterior, sólo a quienes lo hicieron.',
  '["nombre","dias_restantes"]'::jsonb
),
(
  'ofrecimiento-capacitacion-gratuita',
  'Ofrecimiento · Capacitación gratuita',
  'Nueva capacitación gratuita: {{titulo}} · Gestión Global',
  '<!-- manaxer-v1 -->', 'general', true,
  'CAPACITACIÓN GRATUITA',
  '{{titulo}}',
  '#0891b2', true,
  '<p style="margin:0 0 12px;color:#1e293b;">Hola {{nombre}}: abrimos una nueva <strong>capacitación gratuita</strong> para nuestra comunidad de administradores.</p>' ||
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">' ||
  '<strong>{{titulo}}</strong>{{fecha_detalle}}. Sin costo, cupos limitados.</p>' ||
  '<p style="margin:0;color:#1e293b;">Inscribite con un click — te esperamos.</p>',
  'Equipo Gestión Global', 'manaxer-v1',
  'Inscribirme gratis', '{{form_url}}',
  'Motor de ofrecimientos DGG-143: una única invitación el día que se publica cada capacitación gratuita, a clientes no inscriptos (incluye SOLO-CABA).',
  '["nombre","titulo","fecha_detalle","form_url"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
