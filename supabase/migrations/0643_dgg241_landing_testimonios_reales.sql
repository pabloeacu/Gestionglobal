-- 0643_dgg241_landing_testimonios_reales.sql
-- DGG-241 cont (pedido de Pablo 2026-11-04): integrar al carrusel los testimonios
-- REALES de clientes que estaban publicados en el sitio viejo + completar el
-- carrusel de alumnos con los mejores testimonios publicables de las encuestas.
-- 100% ADITIVO: no borra ni reemplaza nada; sólo suma cards reales y enriquece
-- la card existente de Olga con su texto completo real (misma persona).
-- Typos/acentos obvios normalizados para el display de la landing (no se cambia
-- el sentido). Idempotente (NOT EXISTS por nombre / ON CONFLICT por respuesta_id).

-- ============================================================================
-- 1. Olga ya existía como card de SERVICIO (texto condensado) → se enriquece con
--    su testimonio real completo + su administración ("Administración Alas").
-- ============================================================================
-- (Olga = "Administración Romero Núñez"; "Alas" era un nombre de fantasía viejo.)
UPDATE public.landing_testimonios SET
  nombre       = 'Olga E. Romero Núñez',
  curso_titulo = 'Administración Romero Núñez',
  comentario   = 'Sinceramente, me he tomado la libertad de recomendar a varios colegas el servicio de Gestión Global, porque la atención y dedicación que he recibido fue digna de difundir. ¡Excelente!'
WHERE nombre = 'Olga Romero Núñez' AND origen = 'manual' AND respuesta_id IS NULL;

-- ============================================================================
-- 2. Testimonios REALES de clientes (categoria='servicio', manual) — sitio viejo.
-- ============================================================================
INSERT INTO public.landing_testimonios (nombre, comentario, curso_titulo, orden, origen, categoria)
SELECT v.nombre, v.comentario, v.curso_titulo, v.orden, 'manual', 'servicio'
FROM (VALUES
  ('Ing. Sebastián J. I. Libano',
   'Les escribo para agradecerles la rapidez y eficiencia con la que realizaron mi trámite de inscripción al RPAC. La atención fue excelente desde el primer día y el asesoramiento justo hizo que el trámite no demorara más de 1 semana desde iniciado por mi parte.',
   'LIBANO Consorcios', 4),
  ('Ariel Lamberti',
   'Les escribo para agradecer la profesionalidad y la calidad humana de los integrantes de Gestión Global. Pude resolver mi inscripción en el registro público de administradores de la Provincia de Buenos Aires sin inconvenientes y en un plazo breve.',
   'Administración Lamberti', 5),
  ('Juan F. Burgos Borrell',
   'Muy buena la gestión de ustedes. Me facilitó mucho. De hecho mandé a un administrador amigo a que los vea. También quiero seguir con su asesoramiento en otros temas.',
   'Administrador de consorcios', 6),
  ('Ma. Victoria Juárez',
   'Agradezco la gestión, la predisposición en todo momento.',
   'Administradora de consorcios', 7),
  ('MAKTUB Administración',
   'Quisiera agradecer la excelente gestión de esta empresa. A través del Sr. José he podido obtener mi matrícula como Administradora en la Provincia de Buenos Aires. Valoro la respuesta inmediata a todas mis dudas e inquietudes y la rápida y eficaz gestión de este trámite.',
   'Administración de consorcios', 8)
) AS v(nombre, comentario, curso_titulo, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM public.landing_testimonios lt
  WHERE lt.nombre = v.nombre AND lt.origen = 'manual'
);

-- ============================================================================
-- 3. Mejores testimonios de ALUMNOS del pool de encuestas (reales, publicables,
--    5★). Snapshot con nombre/typos normalizados para el display. respuesta_id
--    linkeado (dedup por el índice único parcial).
-- ============================================================================
INSERT INTO public.landing_testimonios (respuesta_id, nombre, comentario, curso_titulo, estrellas, orden, origen, categoria)
VALUES
  ('902c661a-ee40-40ca-9205-b9f0e270bbb1', 'Karina',
   'Es un curso ágil y claro que brinda información que se aplica en la práctica.',
   'Curso de Actualización RPAC', 5.0, 9, 'encuesta', 'alumno'),
  ('83cdc76e-7825-4fa7-889f-493ceafcf8e1', 'Mónica B.B.',
   'Muy buen curso, muy interesante los temas, muy buenos profesores.',
   'Curso de Actualización RPAC', 5.0, 10, 'encuesta', 'alumno'),
  ('afd48e91-9f92-427d-9ffc-4bc5df499488', 'Néstor D''addario',
   'Muy bueno el curso que ustedes brindaron.',
   'Curso de Actualización RPAC', 5.0, 11, 'encuesta', 'alumno'),
  ('55161185-364d-4d32-a6a9-578969068b3f', 'Claudio Di Benedetto',
   'Muy conforme con lo brindado en el curso.',
   'Curso de Actualización RPAC', 5.0, 12, 'encuesta', 'alumno'),
  ('d42bde37-cd34-48d1-9137-b62f5a0a2257', 'Sabino Hernán Sabino',
   'La claridad con que se impartió el curso.',
   'Curso de Actualización RPAC', 5.0, 13, 'encuesta', 'alumno')
ON CONFLICT (respuesta_id) WHERE respuesta_id IS NOT NULL DO NOTHING;
