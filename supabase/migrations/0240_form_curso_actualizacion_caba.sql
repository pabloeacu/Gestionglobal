-- ============================================================================
-- 0240_form_curso_actualizacion_caba.sql
-- DGG-80 · Formulario propio del Curso de Actualización RPA · CABA (GESTAR)
--
-- Hasta ahora la landing tenía 2 tarjetas de actualización (RPAC/FUNDPLATA y
-- RPA-CABA/GESTAR) apuntando AMBAS al mismo formulario `curso-actualizacion`
-- (redactado para RPAC/FUNDPLATA). Para remarcar la dependencia curso↔alianza
-- (logo + subtítulo de la entidad por formulario), Gestar necesita su propio
-- formulario. Lo clonamos de `curso-actualizacion` adaptando:
--   · titulo/descripcion → RPA · CABA
--   · programa: nombre de archivo → RPA-CABA
--   · PAGO: se BLANQUEA la cuenta de FUNDPLATA (FU.DE.CO.IN) — clonarla haría
--     que los alumnos de Gestar paguen a la cuenta equivocada. Queda el bloque
--     vacío (costos_info filtra valores vacíos → no muestra cuenta) + hint "te
--     enviamos los datos por correo" + comprobante NO obligatorio hasta cargar
--     la cuenta real de Gestar. (FLAG a Pablo: cargar la cuenta de Gestar.)
-- El logo + subtítulo de alianza se resuelven en el front por slug
-- (FormularioPublicoPage), sin columna nueva — cambio cosmético.
-- ============================================================================

INSERT INTO public.formularios
  (slug, titulo, descripcion, categoria, servicio_id, publico, activo,
   exige_aceptacion_terminos, notificar_a_emails, mensaje_confirmacion, textos_legales, schema)
SELECT
  'curso-actualizacion-caba',
  'Curso de actualización RPA · CABA',
  'Curso de actualización para la renovación de la matrícula de administrador (RPA · CABA). Modalidad 100% asincrónica, a tu ritmo.',
  categoria, servicio_id, publico, activo,
  exige_aceptacion_terminos, notificar_a_emails, mensaje_confirmacion, textos_legales,
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    schema,
    '{sections,1,fields,0,download_filename}', '"Programa - Curso de actualización RPA-CABA.pdf"'::jsonb),
    '{sections,2,fields,0,hint}', '"Te enviaremos los datos de pago por correo al confirmar tu inscripción."'::jsonb),
    '{sections,2,fields,0,costos,cuenta}', '{"cvu":"","alias":"","titular":"","cuit_cuil":""}'::jsonb),
    '{sections,2,fields,0,costos,nota_extra}', '""'::jsonb),
    '{sections,2,fields,1,required}', 'false'::jsonb),
    '{sections,2,fields,1,hint}', '"Cuando confirmemos tu inscripción te enviaremos los datos de pago por correo. Si ya transferiste, podés adjuntar el comprobante acá."'::jsonb)
FROM public.formularios
WHERE slug='curso-actualizacion'
ON CONFLICT (slug) DO NOTHING;