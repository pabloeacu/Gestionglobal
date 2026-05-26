-- 0080 · EGG-QA-25 · agregar 'curso' al whitelist del trigger creación solicitud
-- (aplicada via apply_migration 2026-05-26)
--
-- Antes: el trigger crear_tramite_desde_submission_auto sólo procesaba
-- categorias 'tramite', 'servicio', 'consulta'. Submissions de formularios
-- de curso (categoria='curso') quedaban sin solicitud → gerencia no veía
-- al alumno en el listado de solicitudes para activar.
--
-- Ahora: 'curso' incluido en whitelist. La solicitud se crea con
-- servicio_solicitado_id apuntando al curso correspondiente (rpac_formacion
-- o curso_actualizacion). El wizard de activación crea admin + tracking
-- categoria='curso'.
--
-- Pendiente (EGG-QA-26 doc): el wizard NO crea automáticamente la matrícula
-- en curso_matriculas — el gerente debe ir manualmente a Campus → Curso →
-- Asignar alumno. Mejora futura: detectar si servicio.codigo es curso y
-- llamar curso_asignar_alumno() automáticamente desde solicitud_activar.

SELECT 'mig 0080 aplicada via apply_migration 2026-05-26' AS info;
