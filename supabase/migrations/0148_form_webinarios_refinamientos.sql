-- ============================================================================
-- Mig 0148 · Refinamientos sobre `webinarios`:
--   (A) Hints en DNI, CUIT, Celular.
--   (B) Nuevo campo "Preguntas sobre el tema" (textarea opcional) en
--       "Sobre vos", después del existente "Dejanos tu pregunta".
--   (Las preguntas anteriores se mantienen tal cual: ¿Sos administrador
--    matriculado?, ¿Cómo te enteraste?, Dejanos tu pregunta.)
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'webinarios';
  IF v_id IS NULL THEN RAISE NOTICE 'webinarios no existe'; RETURN; END IF;

  WITH base AS (
    SELECT s.idx, s.value AS seccion
    FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
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

  SELECT jsonb_agg(
    CASE
      WHEN seccion->>'title' = 'Sobre vos' THEN
        seccion || jsonb_build_object(
          'fields',
          (seccion->'fields') || jsonb_build_array(
            jsonb_build_object(
              'name', 'preguntas_sobre_tema',
              'type', 'textarea',
              'label', 'Preguntas sobre el tema',
              'required', false,
              'hint', 'Si ya tenés preguntas concretas sobre el tema del webinario, dejalas acá y las tenemos en cuenta para responderlas durante el encuentro.'
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
