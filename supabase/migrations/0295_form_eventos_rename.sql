-- 0295 · Eventos (Pablo): el formulario compartido de inscripción se llamaba
-- 'webinarios' (slug viejo). Se renombra a 'eventos' + retítulo. El vínculo al
-- evento vigente NO usa el slug (usa categoria='evento' + webinar_vigente_id),
-- así que el rename no rompe el ruteo. La URL pública del formulario
-- (/formulario/eventos) redirige a /eventos (identidad del evento vigente) desde
-- el front (FormularioPublicoPage).
UPDATE public.formularios
   SET slug = 'eventos',
       titulo = 'Inscripción a eventos'
 WHERE slug = 'webinarios' AND categoria = 'evento';
