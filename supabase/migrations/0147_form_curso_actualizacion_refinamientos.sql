-- ============================================================================
-- Mig 0147 · Refinamientos sobre `curso-actualizacion` tras cruce con docx:
--   (A) Eliminar sección "Contacto" duplicada.
--   (B) Eliminar sección "Antecedentes" entera (año última actualización +
--       comprobante de matrícula opcional).
--   (C) Eliminar sección "Modalidad" (el curso es lo que es).
--   (D) Eliminar sección "Términos" (decisión del usuario).
--   (E) Hints en DNI, CUIT, Celular, Nº matrícula.
--   (F) Nueva sección "Programa del curso" con file_download placeholder
--       (download_url vacío, se carga cuando esté).
--   (G) Nueva sección "Pago": Comprobante de pago (file requerido, voucher
--       100% lo exime).
--   (H) Nueva sección "Observaciones" al final (textarea opcional).
--   (NO se agrega 'Curso en el que me inscribo' — los formularios de
--    GESTAR / Combo se harán separados.)
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'curso-actualizacion';
  IF v_id IS NULL THEN RAISE NOTICE 'curso-actualizacion no existe'; RETURN; END IF;

  SELECT jsonb_agg(s.value ORDER BY s.idx)
  INTO v_sections
  FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
  WHERE s.value->>'title' = 'Identificación';

  WITH base AS (
    SELECT s.idx, s.value AS seccion
    FROM jsonb_array_elements(v_sections) WITH ORDINALITY s(value, idx)
  ),
  fields AS (
    SELECT b.idx AS s_idx, b.seccion->>'title' AS s_title, f.idx AS f_idx, f.value AS field
    FROM base b, jsonb_array_elements(b.seccion->'fields') WITH ORDINALITY f(value, idx)
  ),
  patched AS (
    SELECT s_idx, s_title, f_idx,
      CASE
        WHEN field->>'name' = 'dni' THEN field || jsonb_build_object('hint', 'Sin puntos ni guiones.')
        WHEN field->>'name' = 'cuit' THEN field || jsonb_build_object('hint', '11 dígitos sin guiones.')
        WHEN field->>'name' = 'celular' THEN field || jsonb_build_object('hint', 'Incluí característica con el 9 (móvil).')
        WHEN field->>'name' = 'matricula_rpac' THEN field || jsonb_build_object('hint', 'Tal como figura en tu credencial.')
        ELSE field
      END AS field
    FROM fields
  ),
  fields_by_section AS (
    SELECT s_idx, jsonb_agg(field ORDER BY f_idx) AS arr FROM patched GROUP BY s_idx
  ),
  rebuilt AS (
    SELECT b.idx, (b.seccion || jsonb_build_object('fields', fbs.arr)) AS seccion
    FROM base b JOIN fields_by_section fbs ON fbs.s_idx = b.idx
  ),
  arr AS (
    SELECT jsonb_agg(seccion ORDER BY idx) AS sections FROM rebuilt
  )
  SELECT sections INTO v_sections FROM arr;

  v_sections := v_sections || jsonb_build_array(
    jsonb_build_object(
      'title', 'Programa del curso',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'name', 'programa_curso_modelo',
          'type', 'file_download',
          'label', 'Descargá el programa del curso',
          'required', false,
          'hint', 'Programa con contenidos, módulos y carga horaria. Si todavía no está cargado, lo subimos en cuanto esté disponible.',
          'download_url', '',
          'download_filename', 'Programa - Curso de actualización RPAC.pdf'
        )
      )
    ),
    jsonb_build_object(
      'title', 'Pago',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'name', 'comprobante_pago_inscripcion',
          'type', 'file',
          'label', 'Adjuntar comprobante de pago',
          'required', true,
          'hint', 'Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección "Voucher" y este campo se omitirá automáticamente.'
        )
      )
    ),
    jsonb_build_object(
      'title', 'Observaciones',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'name', 'observaciones',
          'type', 'textarea',
          'label', 'Observaciones / Comentarios',
          'required', false,
          'hint', 'Cualquier dato adicional que quieras dejar registrado.'
        )
      )
    )
  );

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_sections),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
