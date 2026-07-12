-- 0326 · #7 (reporte JL) + ★ aguja de wiring.
--
-- #7: los títulos de los 3 cursos nunca se alinearon a los nombres oficiales
-- (son los del seed 0023/0240; ninguna migración los cambió). Los llevamos a
-- los nombres que pidió JL, de forma CONSISTENTE en las 3 superficies:
--   · formularios.titulo  → la card pública
--   · cursos.titulo        → campus + emails/certificados (interpolan cursos.titulo)
--   · servicios.nombre     → tabulador / descripción de servicio
-- (La landing tiene copy hardcodeado + la clave ALIANZA_ISOLOGO por título;
--  eso se ajusta en el front, en el mismo deploy.)
--
-- ★ Aguja pre-existente (0240 clonó el form CABA del RPAC): el formulario
-- `curso-actualizacion-caba` apuntaba al servicio `curso_actualizacion_rpac`
-- en vez de `rpa_actualizacion`. Precio idéntico ($80k) pero mis-categorizaba
-- las inscripciones CABA. Reapuntamos el form y completamos el slug del servicio.

-- ── Nombres oficiales ───────────────────────────────────────────────────────
-- ① RPAC / PBA
UPDATE public.formularios SET titulo = 'Curso de Actualización RPAC (Pcia. de Bs. As.)', updated_at = now()
  WHERE slug = 'curso-actualizacion';
UPDATE public.cursos SET titulo = 'Curso de Actualización RPAC (Pcia. de Bs. As.)', updated_at = now()
  WHERE slug = 'actualizacion2026-rpac';
UPDATE public.servicios SET nombre = 'Curso de Actualización RPAC (Pcia. de Bs. As.)'
  WHERE codigo = 'curso_actualizacion_rpac';

-- ② RPA / CABA
UPDATE public.formularios SET titulo = 'Curso de Actualización RPA (CABA)', updated_at = now()
  WHERE slug = 'curso-actualizacion-caba';
UPDATE public.cursos SET titulo = 'Curso de Actualización RPA (CABA)', updated_at = now()
  WHERE slug = 'curso-actualizacion-2026-rpa-caba';
UPDATE public.servicios SET nombre = 'Curso de Actualización RPA (CABA)'
  WHERE codigo = 'rpa_actualizacion';

-- ③ Capacitación Inicial / Formación (PBA)
UPDATE public.formularios SET titulo = 'Curso de Capacitación Inicial o Formación (Pcia. de Bs. As.)', updated_at = now()
  WHERE slug = 'curso-formacion';
UPDATE public.cursos SET titulo = 'Curso de Capacitación Inicial o Formación (Pcia. de Bs. As.)', updated_at = now()
  WHERE slug = 'formacion-inicial-administradores';
UPDATE public.servicios SET nombre = 'Curso de Capacitación Inicial o Formación (Pcia. de Bs. As.)'
  WHERE codigo = 'curso_formacion_rpac';

-- ── ★ Wiring CABA form ↔ servicio correcto ──────────────────────────────────
UPDATE public.formularios
   SET servicio_id = '56632a78-d373-4604-9639-c89e77d87317'  -- rpa_actualizacion
 WHERE slug = 'curso-actualizacion-caba';
UPDATE public.servicios
   SET formulario_publico_slug = 'curso-actualizacion-caba'
 WHERE codigo = 'rpa_actualizacion';
