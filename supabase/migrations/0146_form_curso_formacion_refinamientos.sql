-- ============================================================================
-- Mig 0146 · Refinamientos sobre `curso-formacion` (Título habilitante RPAC):
--   (A) Eliminar sección "Contacto" duplicada — Localidad y Provincia se
--       mueven a "Tus datos" para no perderlas.
--   (B) Eliminar sección "Sobre vos" entera (nivel educativo, motivación,
--       cómo nos conociste).
--   (C) Eliminar sección "Modalidad" entera (el curso es lo que es, no se
--       elige modalidad).
--   (D) Hints en DNI, CUIT, Celular, Fecha de nacimiento.
--   (E) Nueva sección "Sobre vos": ¿Administrás consorcios actualmente?
--       (radio Sí/No).
--   (F) Nueva sección "Programa del curso" con file_download — placeholder
--       con download_url vacío, listo para cargar el PDF cuando esté.
--   (G) Nueva sección "Pago" con Comprobante de pago (file requerido,
--       respeta voucher 100%).
--   (H) Nueva sección "Observaciones" (textarea opcional) antes de Términos.
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
  v_localidad jsonb;
  v_provincia jsonb;
  v_terminos jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'curso-formacion';
  IF v_id IS NULL THEN RAISE NOTICE 'curso-formacion no existe'; RETURN; END IF;

  SELECT c.value INTO v_localidad
  FROM jsonb_array_elements(v_schema->'sections') AS s,
       jsonb_array_elements(s.value->'fields') AS c
  WHERE s.value->>'title' = 'Contacto' AND c.value->>'name' = 'localidad';
  SELECT c.value INTO v_provincia
  FROM jsonb_array_elements(v_schema->'sections') AS s,
       jsonb_array_elements(s.value->'fields') AS c
  WHERE s.value->>'title' = 'Contacto' AND c.value->>'name' = 'provincia';

  SELECT s.value INTO v_terminos
  FROM jsonb_array_elements(v_schema->'sections') AS s
  WHERE s.value->>'title' = 'Términos';

  SELECT jsonb_agg(s.value ORDER BY s.idx)
  INTO v_sections
  FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
  WHERE s.value->>'title' NOT IN ('Contacto', 'Sobre vos', 'Modalidad', 'Términos');

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
        WHEN field->>'name' = 'fecha_nacimiento' THEN field || jsonb_build_object('hint', 'DD/MM/AAAA. Sirve para certificar tu identidad.')
        ELSE field
      END AS field
    FROM fields
  ),
  fields_by_section AS (
    SELECT s_idx, jsonb_agg(field ORDER BY f_idx) AS arr FROM patched GROUP BY s_idx
  ),
  rebuilt AS (
    SELECT b.idx,
      CASE
        WHEN b.seccion->>'title' = 'Tus datos'
          THEN b.seccion || jsonb_build_object('fields',
            fbs.arr || jsonb_build_array(v_localidad, v_provincia))
        ELSE b.seccion || jsonb_build_object('fields', fbs.arr)
      END AS seccion
    FROM base b JOIN fields_by_section fbs ON fbs.s_idx = b.idx
  ),
  arr AS (
    SELECT jsonb_agg(seccion ORDER BY idx) AS sections FROM rebuilt
  )
  SELECT sections INTO v_sections FROM arr;

  v_sections := v_sections || jsonb_build_array(
    jsonb_build_object(
      'title', 'Sobre vos',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'name', 'administra_consorcios_actualmente',
          'type', 'radio',
          'label', '¿Administrás consorcios actualmente?',
          'required', true,
          'options', jsonb_build_array('Sí', 'No')
        )
      )
    ),
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
          'download_filename', 'Programa - Curso de formación RPAC.pdf'
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
    ),
    v_terminos
  );

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_sections),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
