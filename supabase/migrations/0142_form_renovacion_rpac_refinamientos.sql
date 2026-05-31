-- ============================================================================
-- Mig 0142 · Refinamientos sobre `renovacion-rpac` tras cruzarlo con el docx:
--   (A) Eliminar sección "Antecedentes" completa (radio + textarea).
--   (B) Eliminar sección "Contacto" duplicada (email + teléfono ya van en
--       Identificación).
--   (C) Renombrar "Certificado de curso de actualización (vencimiento < 2
--       años)" → "Certificado de curso de actualización".
--   (D) Agregar "Comprobante de pago de renovación" (file, requerido).
--   (E) Agregar sección "Observaciones" (textarea opcional) antes de la
--       Declaración jurada.
--   (F) Hints en DNI, CUIT, Celular, Nº matrícula, Certificado curso,
--       Constancia AFIP, Comprobante de pago.
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'renovacion-rpac';
  IF v_id IS NULL THEN RAISE NOTICE 'renovacion-rpac no existe'; RETURN; END IF;

  -- 1. Filtramos secciones: descartamos Antecedentes y Contacto.
  SELECT jsonb_agg(s.value ORDER BY s.idx)
  INTO v_sections
  FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
  WHERE s.value->>'title' NOT IN ('Antecedentes', 'Contacto');

  -- 2. Patch a los campos: rename del certificado + hints en campos comunes.
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
        WHEN field->>'name' = 'certificado_curso_actualizacion_vigente' THEN
          field || jsonb_build_object(
            'label', 'Certificado de curso de actualización',
            'hint',  'Aprobación del curso de actualización.'
          )
        WHEN field->>'name' = 'constancia_afip_actualizada' THEN
          field || jsonb_build_object('hint', 'Constancia actualizada del Monotributo o Ganancias / IVA.')
        ELSE field
      END AS field
    FROM fields
  ),
  fields_by_section AS (
    SELECT s_idx, jsonb_agg(field ORDER BY f_idx) AS arr FROM patched GROUP BY s_idx
  ),
  rebuilt AS (
    SELECT b.idx, (b.seccion || jsonb_build_object('fields', fbs.arr)) AS seccion
    FROM base b
    JOIN fields_by_section fbs ON fbs.s_idx = b.idx
  ),
  arr AS (
    SELECT jsonb_agg(seccion ORDER BY idx) AS sections FROM rebuilt
  )
  SELECT sections INTO v_sections FROM arr;

  -- 3. Append "Comprobante de pago de renovación" al final de Documentación.
  SELECT jsonb_agg(
    CASE
      WHEN seccion->>'title' = 'Documentación requerida' THEN
        seccion || jsonb_build_object(
          'fields',
          (seccion->'fields') || jsonb_build_array(
            jsonb_build_object(
              'name', 'comprobante_pago_renovacion',
              'type', 'file',
              'label', 'Comprobante de pago de renovación',
              'required', true,
              'hint', 'Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección "Voucher" y este campo se omitirá automáticamente.'
            )
          )
        )
      ELSE seccion
    END
  ) INTO v_sections FROM jsonb_array_elements(v_sections) AS seccion;

  -- 4. Insertar sección "Observaciones" antes de "Declaración jurada".
  WITH ordered AS (
    SELECT s.idx, s.value FROM jsonb_array_elements(v_sections) WITH ORDINALITY s(value, idx)
  ),
  final_sections AS (
    SELECT CASE
      WHEN value->>'title' = 'Declaración jurada' THEN
        jsonb_build_array(
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
          ),
          value
        )
      ELSE jsonb_build_array(value)
    END AS pack, idx
    FROM ordered
  ),
  flat AS (
    SELECT jsonb_agg(elem ORDER BY idx, ord) AS sections
    FROM final_sections, jsonb_array_elements(pack) WITH ORDINALITY el(elem, ord)
  )
  SELECT sections INTO v_sections FROM flat;

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_sections),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
