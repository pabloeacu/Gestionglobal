-- 0636 · DGG-239 — Alinear el copy de modalidad del Curso de Actualización
-- RPAC (Pcia. de Bs. As.) con la composición correcta confirmada por Pablo:
--   modalidad MIXTA a distancia = 4 asignaturas ASINCRÓNICAS (a tu ritmo)
--   + 2 SINCRÓNICAS EN VIVO, con material inédito / manuales teórico-prácticos
--   EXCLUSIVOS para los alumnos.
--
-- Causa (E-GG-245): al reemplazar el popup del landing (curso-formación →
-- actualización) se corrigió el copy del popup pero NO las otras superficies
-- que describen el MISMO curso. Quedaron incoherentes (regla §6 2-bis-e
-- "coherencia aviso↔display"):
--   · formularios.descripcion  → "Modalidad presencial, virtual en vivo o
--     asincrónica."  (FALSO: no hay instancia presencial; vago)
--   · servicios.descripcion    → "...· asincrónico + tutorías"  (no refleja
--     las 2 asignaturas sincrónicas en vivo ni el material exclusivo)
--   (las dos superficies hardcodeadas del landing se alinean en LandingPage.tsx)
--
-- Sólo PBA (RPAC). El Curso de Actualización RPA (CABA) es otro curso
-- (100% asincrónico, entidad Gestar) y su copy es correcto → NO se toca.
--
-- Cambio de CONTENIDO (no de schema). Versionado acá para no dejar drift y
-- que un restore reproduzca el copy correcto (precedente: 0073, 0168).

update public.formularios
set descripcion = 'Curso obligatorio para mantener vigente tu matrícula RPAC. Modalidad mixta a distancia: 4 asignaturas asincrónicas a tu ritmo + 2 sincrónicas en vivo, con material inédito y manuales teórico-prácticos exclusivos.',
    updated_at = now()
where slug = 'curso-actualizacion';

update public.servicios s
set descripcion = 'Curso obligatorio para renovación · mixto a distancia: 4 asignaturas asincrónicas + 2 sincrónicas en vivo · material exclusivo',
    updated_at = now()
from public.formularios f
where f.slug = 'curso-actualizacion'
  and s.id = f.servicio_id;
