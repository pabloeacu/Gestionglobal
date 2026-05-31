-- ============================================================================
-- Mig 0143 · Refinamientos sobre `certificado-rpac` tras cruzar con docx:
--   (A) Quitar campos fantasma: 'apellido_nombre' y 'telefono' (no
--       requeridos, duplicados con apellido + nombre + celular).
--   (B) Hints en DNI, CUIT, Celular, Nº matrícula.
--   (C) Nueva sección "Documentación requerida" con "Comprobante de pago
--       de la solicitud" (file, requerido, voucher 100% lo exime).
--   (D) Nueva sección "Observaciones" (textarea opcional) al final.
--   (Foto carnet: NO se agrega — el docx no la pide para este trámite.)
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'certificado-rpac';
  IF v_id IS NULL THEN RAISE NOTICE 'certificado-rpac no existe'; RETURN; END IF;

  WITH base AS (
    SELECT s.idx, s.value AS seccion
    FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
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
    WHERE NOT (s_title = 'Datos del solicitante'
               AND field->>'name' IN ('apellido_nombre', 'telefono'))
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
        WHEN field->>'name' = 'matricula' THEN
          field || jsonb_build_object('hint', 'Tal como figura en tu credencial.')
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

  v_sections := v_sections || jsonb_build_array(
    jsonb_build_object(
      'title', 'Documentación requerida',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'name', 'comprobante_pago_certificado',
          'type', 'file',
          'label', 'Comprobante de pago de la solicitud',
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
          'label', 'Observaciones',
          'required', false,
          'hint', 'Algo que quieras dejar en claro para tu trámite.'
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
