-- ============================================================================
-- 0459 · DGG-148 — Banner "Listo para cerrar" en el dashboard de gerencia.
-- ----------------------------------------------------------------------------
-- Pablo: el aviso "Listo para cerrar · <alumno>" (mail + campanita, mig 0453)
-- también tiene que aparecer como BANNER en el Inicio de gerencia, para
-- reforzarlo y que no se pase.
--
-- Esta RPC devuelve el universo de matrículas "listas para cerrar" — ESPEJO
-- EXACTO del gate del asistente de cierre (TrackingDetailPage) y del trigger del
-- aviso (0453): plazo de gracia terminado (estado='vencida') o curso sin ventana
-- de repaso (estado='completada' sin vigencia_hasta), Y el trámite todavía NO
-- está cerrado/cancelado (resuelto SÍ cuenta: falta la ceremonia de cierre +
-- programar el próximo vencimiento). Cuando el gerente cierra el trámite, la
-- fila desaparece del banner. Staff-only (regla 2 / regla 12: se auto-gatea).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dashboard_listo_para_cerrar()
RETURNS TABLE(
  matricula_id     uuid,
  tramite_id       uuid,
  curso_titulo     text,
  cliente_nombre   text,
  matricula_estado text,
  listo_desde      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RETURN; -- no-staff: universo vacío (el widget sólo vive en el home de gerencia)
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.tramite_id,
         c.titulo,
         COALESCE(a.nombre, p.full_name, 'Alumno'),
         m.estado,
         COALESCE(m.updated_at, m.created_at)
    FROM public.curso_matriculas m
    JOIN public.cursos c    ON c.id = m.curso_id
    JOIN public.tramites t  ON t.id = m.tramite_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    LEFT JOIN public.profiles p         ON p.id = m.profile_id
   WHERE m.tramite_id IS NOT NULL
     AND t.estado NOT IN ('cerrado', 'cancelado')
     AND (
           m.estado = 'vencida'
           OR (m.estado = 'completada' AND m.vigencia_hasta IS NULL)
         )
   ORDER BY COALESCE(m.updated_at, m.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_listo_para_cerrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_listo_para_cerrar() TO authenticated;
