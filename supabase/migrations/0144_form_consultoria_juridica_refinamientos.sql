-- ============================================================================
-- Mig 0144 · Refinamientos sobre `consultoria-juridica` tras cruzar con docx:
--   (A) Quitar campo fantasma 'apellido_nombre' (no requerido, duplica
--       Apellido + Nombre).
--   (B) Hint en Celular ("Incluí característica con el 9 (móvil).").
--   (C) Hint en "¿Cuál es la consulta?" ("Describí tu consulta jurídica
--       con el mayor detalle posible.").
--   (D) Hint en "Adjuntar documentación para análisis" ("Podés adjuntar
--       reglamento de copropiedad, actas o cualquier documento que
--       consideres relevante.").
--   (E) Hint en "Adjuntar comprobante de pago" (regla del voucher 100%).
--   (NO se agrega Observaciones — el campo `consulta` ya cubre texto libre.)
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_sections jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'consultoria-juridica';
  IF v_id IS NULL THEN RAISE NOTICE 'consultoria-juridica no existe'; RETURN; END IF;

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
    WHERE NOT (s_title = 'Quién consulta' AND field->>'name' = 'apellido_nombre')
  ),
  patched AS (
    SELECT
      s_idx, s_title, f_idx,
      CASE
        WHEN field->>'name' = 'celular' THEN
          field || jsonb_build_object('hint', 'Incluí característica con el 9 (móvil).')
        WHEN field->>'name' = 'consulta' THEN
          field || jsonb_build_object('hint', 'Describí tu consulta jurídica con el mayor detalle posible.')
        WHEN field->>'name' = 'docs_analisis' THEN
          field || jsonb_build_object('hint', 'Podés adjuntar reglamento de copropiedad, actas o cualquier documento que consideres relevante.')
        WHEN field->>'name' = 'comprobante_pago' THEN
          field || jsonb_build_object('hint', 'Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección "Voucher" y este campo se omitirá automáticamente.')
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

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_sections),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
