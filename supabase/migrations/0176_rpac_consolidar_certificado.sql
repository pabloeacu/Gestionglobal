-- ============================================================================
-- 0176 · JL-RPAC · Consolidar 2 campos redundantes del formulario
--                 matriculacion-rpac en uno solo.
--
-- Pedido de José Luis (2026-06-02): los campos
--   1) `titulo_secundario_o_superior` (label "Título emitido por entidad
--      habilitada por el RPAC", hint "Adjuntá el título o certificado
--      emitido por una entidad habilitada por el Registro.")
--   2) `certificado_curso_administradores` (label "Certificado del curso
--      de administradores", hint "Aprobación del curso integral de
--      Administradores de Consorcios.")
-- son el MISMO documento. Se consolidan en uno único:
--   - name: `certificado_curso_administradores` (sobrevive — el otro era
--     mal-nombrado: "título secundario" no es del RPAC, era confuso).
--   - label: "Certificado del Curso de formación de Administrador de
--     Consorcios".
--   - hint: "Emitido por una entidad habilitada por el RPAC".
--
-- Auditoría transversal previa (regla "auditar a fondo"): los 4
-- formularios RPAC fueron revisados. Solo `matriculacion-rpac` tiene los
-- 2 campos. `matriculacion-rpac-juridica` (anexo societario, sin curso
-- — la persona jurídica no rinde el curso, lo rinde el administrador
-- titular), `renovacion-rpac` (tiene `certificado_curso_actualizacion_vigente`
-- que es DISTINTO: el curso bianual de actualización para mantener la
-- matrícula vigente) y `certificado-rpac` (no tiene ninguno de los dos)
-- NO tienen el problema.
--
-- Submissions afectadas: 0 con datos en cualquiera de los 2 campos
-- (verificado con `count(*) FILTER (WHERE datos ? '...')`). Safe to
-- refactor sin migración de datos.
--
-- El frontend lee `formularios.schema` directo (ver
-- `getFormularioPorSlug` en `src/services/api/formularios.ts:90`),
-- la tabla `formulario_versiones` es sólo historial. Sólo se actualiza
-- `formularios.schema`.
-- ============================================================================

DO $$
DECLARE
  v_schema       jsonb;
  v_new_sections jsonb := '[]'::jsonb;
  v_new_fields   jsonb;
  sec            jsonb;
  fld            jsonb;
BEGIN
  SELECT schema INTO v_schema
    FROM public.formularios WHERE slug = 'matriculacion-rpac';

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Formulario matriculacion-rpac no encontrado';
  END IF;

  FOR sec IN SELECT * FROM jsonb_array_elements(v_schema->'sections')
  LOOP
    v_new_fields := '[]'::jsonb;
    FOR fld IN SELECT * FROM jsonb_array_elements(sec->'fields')
    LOOP
      IF fld->>'name' = 'titulo_secundario_o_superior' THEN
        -- Skip: este campo era redundante.
        CONTINUE;
      ELSIF fld->>'name' = 'certificado_curso_administradores' THEN
        -- Actualizar label + hint al copy unificado pedido por JL.
        v_new_fields := v_new_fields || jsonb_build_array(
          fld
            || jsonb_build_object(
                 'label', 'Certificado del Curso de formación de Administrador de Consorcios',
                 'hint',  'Emitido por una entidad habilitada por el RPAC'
               )
        );
      ELSE
        v_new_fields := v_new_fields || jsonb_build_array(fld);
      END IF;
    END LOOP;
    v_new_sections := v_new_sections || jsonb_build_array(
      jsonb_set(sec, '{fields}', v_new_fields)
    );
  END LOOP;

  UPDATE public.formularios
     SET schema = jsonb_set(v_schema, '{sections}', v_new_sections, true),
         updated_at = now()
   WHERE slug = 'matriculacion-rpac';

  RAISE NOTICE 'matriculacion-rpac · campo consolidado OK';
END $$;
