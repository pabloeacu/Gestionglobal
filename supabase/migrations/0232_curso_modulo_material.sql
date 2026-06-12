-- ============================================================================
-- 0232 · curso_modulo_material · "Material extra" por módulo
-- ----------------------------------------------------------------------------
-- Cada módulo (curso_modulos) puede tener material complementario: links o
-- archivos varios. Opera como la bibliografía del curso (curso_bibliografia)
-- pero a nivel MÓDULO. Regla de negocio: la sección "Material extra" es parte
-- del módulo siempre (la gerencia siempre puede cargar), pero al ALUMNO sólo se
-- le muestra si el módulo tiene ≥1 ítem — eso es condición de render en el front
-- (CursoDetalleAlumnoPage); acá modelamos sólo datos + RLS.
-- Naming alineado con curso_bibliografia (regla 8 / E43): titulo/url/archivo_url/
-- descripcion. Single-table → sin RPC (regla 5).
-- ============================================================================
CREATE TABLE public.curso_modulo_material (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id   uuid NOT NULL REFERENCES public.curso_modulos(id) ON DELETE CASCADE,
  titulo      text NOT NULL,
  url         text,
  archivo_url text,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.curso_modulo_material ENABLE ROW LEVEL SECURITY;

-- Regla 6 (post-mig 0130): GRANT explícito en la misma migración.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curso_modulo_material TO authenticated;

-- Regla 11: índice de la FK (Postgres NO lo crea solo).
CREATE INDEX curso_modulo_material_modulo_id_idx
  ON public.curso_modulo_material(modulo_id);

-- SELECT: staff (gerente) o alumno matriculado del curso al que pertenece el
-- módulo. Como la tabla cuelga de modulo_id (no curso_id), dereferencia
-- módulo→curso — espeja EXACTAMENTE curso_clases_select.
CREATE POLICY curso_modulo_material_select ON public.curso_modulo_material
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(
         (SELECT curso_id FROM public.curso_modulos
           WHERE id = curso_modulo_material.modulo_id)
       )
  );

-- CUD: staff-only (espeja curso_clases_cud / curso_bibliografia_cud).
CREATE POLICY curso_modulo_material_cud ON public.curso_modulo_material
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());
