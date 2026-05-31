-- ============================================================================
-- Mig 0145 · Refinamientos sobre `ddjj-anual` tras cruzar con docx + decisión
-- del usuario de pedir un archivo modelo descargable + carga del archivo
-- completo en lugar de un textarea de listado.
--   (A) Quitar campos fantasma 'apellido_nombre' y 'telefono' en
--       Identificación.
--   (B) Hints en DNI, CUIT, Celular, Nº matrícula, comprobante DGR.
--   (C) Eliminar sección "Consorcios administrados" entera (cantidad +
--       listado textarea) — se reemplaza por descargar+subir planilla.
--   (D) Eliminar "Nómina de consorcios (PDF firmado)" en Documentación.
--   (E) Agregar en Documentación:
--         · file_download "Descargá la planilla modelo" (URL del xlsx
--           subido al bucket `formulario-descargas/ddjj-anual/…`).
--         · file "Listado de consorcios administrados (planilla completa)"
--           (required).
--   (NO se agrega firma; NO se agrega Observaciones.)
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
  c_planilla_url constant text :=
    'https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/formulario-descargas/ddjj-anual/datos-de-consorcios-modelo.xlsx';
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'ddjj-anual';
  IF v_id IS NULL THEN RAISE NOTICE 'ddjj-anual no existe'; RETURN; END IF;

  SELECT jsonb_agg(s.value ORDER BY s.idx)
  INTO v_sections
  FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
  WHERE s.value->>'title' <> 'Consorcios administrados';

  WITH base AS (
    SELECT s.idx, s.value AS seccion
    FROM jsonb_array_elements(v_sections) WITH ORDINALITY s(value, idx)
  ),
  fields AS (
    SELECT
      b.idx AS s_idx,
      b.seccion->>'title' AS s_title,
      f.idx AS f_idx,
      f.value AS field
    FROM base b, jsonb_array_elements(b.seccion->'fields') WITH ORDINALITY f(value, idx)
  ),
  filtered AS (
    SELECT * FROM fields
    WHERE NOT (s_title = 'Identificación'
               AND field->>'name' IN ('apellido_nombre', 'telefono'))
      AND NOT (s_title = 'Documentación requerida'
               AND field->>'name' = 'nomina_consorcios_pdf')
  ),
  patched AS (
    SELECT
      s_idx, s_title, f_idx,
      CASE
        WHEN field->>'name' = 'dni' THEN
          field || jsonb_build_object('hint', 'Sin puntos ni guiones.')
        WHEN field->>'name' = 'cuit' THEN
          field || jsonb_build_object('hint', '11 dígitos sin guiones.')
        WHEN field->>'name' = 'celular' THEN
          field || jsonb_build_object('hint', 'Incluí característica con el 9 (móvil).')
        WHEN field->>'name' = 'matricula_rpac' THEN
          field || jsonb_build_object('hint', 'Tal como figura en tu credencial.')
        WHEN field->>'name' = 'comprobante_pago_dgr' THEN
          field || jsonb_build_object('hint', 'Comprobante de pago anual a la Dirección General de Rentas (DGR).')
        ELSE field
      END AS field
    FROM filtered
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

  SELECT jsonb_agg(
    CASE
      WHEN seccion->>'title' = 'Documentación requerida' THEN
        seccion || jsonb_build_object(
          'fields',
          (seccion->'fields') || jsonb_build_array(
            jsonb_build_object(
              'name', 'planilla_consorcios_modelo',
              'type', 'file_download',
              'label', 'Descargá la planilla modelo',
              'required', false,
              'hint', 'Descargala, completala en tu computadora con los datos de los consorcios que administrás durante el período y subila más abajo.',
              'download_url', c_planilla_url,
              'download_filename', 'Datos de Consorcios - Gestión Global.xlsx'
            ),
            jsonb_build_object(
              'name', 'planilla_consorcios_completa',
              'type', 'file',
              'label', 'Listado de consorcios administrados (planilla completa)',
              'required', true,
              'hint', 'Subí la planilla modelo que descargaste arriba ya completa con los datos de los consorcios del período declarado.'
            )
          )
        )
      ELSE seccion
    END
  ) INTO v_sections FROM jsonb_array_elements(v_sections) AS seccion;

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_sections),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
