-- ============================================================================
-- Mig 0141 · Refinamientos sobre el formulario `matriculacion-rpac` tras
-- cruzarlo con el relevamiento de Google Forms (sesión 30/05/2026):
--   (1) Renombrar campo "Título secundario o superior" →
--       "Título emitido por entidad habilitada por el RPAC".
--   (2) Agregar campo "Comprobante de pago de matrícula" (file requerido).
--   (3) Textos de ayuda nuevos en campos comunes.
--   (4) Cónyuge condicional: visible solo si estado_civil ∈
--       {casado, union_convivencial}.
-- ============================================================================

DO $$
DECLARE
  v_id uuid;
  v_schema jsonb;
  v_secciones jsonb;
BEGIN
  SELECT id, schema INTO v_id, v_schema
  FROM public.formularios WHERE slug = 'matriculacion-rpac';
  IF v_id IS NULL THEN RAISE NOTICE 'matriculacion-rpac no existe'; RETURN; END IF;

  WITH base AS (
    SELECT s.idx, s.value AS seccion FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(value, idx)
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
        WHEN field->>'label' = 'Título secundario o superior' THEN
          field || jsonb_build_object(
            'label', 'Título emitido por entidad habilitada por el RPAC',
            'hint',  'Adjuntá el título o certificado emitido por una entidad habilitada por el Registro.'
          )
        WHEN field->>'name' = 'dni' AND s_title = 'Datos personales' THEN
          field || jsonb_build_object('hint', 'Sin puntos ni guiones.')
        WHEN field->>'name' = 'cuit' AND s_title = 'Datos personales' THEN
          field || jsonb_build_object('hint', '11 dígitos sin guiones.')
        WHEN field->>'name' = 'celular' THEN
          field || jsonb_build_object('hint', 'Incluí característica con el 9 (móvil).')
        WHEN field->>'name' = 'estado_civil' THEN
          field || jsonb_build_object(
            'hint', 'Si seleccionás casado/a o unión convivencial completá los datos del cónyuge debajo.'
          )
        WHEN field->>'label' = 'Foto carnet 4x4' THEN
          field || jsonb_build_object('hint', 'Foto color reciente, fondo blanco, sin lentes ni gorro.')
        WHEN field->>'label' = 'Certificado del curso de administradores' THEN
          field || jsonb_build_object('hint', 'Aprobación del curso integral de Administradores de Consorcios.')
        WHEN field->>'label' = 'Constancia de inscripción AFIP' THEN
          field || jsonb_build_object('hint', 'Constancia actualizada del Monotributo o Ganancias / IVA.')
        WHEN field->>'name' = 'apellido_nombre_conyuge' THEN
          field || jsonb_build_object(
            'condition', jsonb_build_object(
              'field', 'estado_civil',
              'equals', jsonb_build_array('casado', 'union_convivencial')
            )
          )
        WHEN field->>'name' = 'cuit_conyuge' THEN
          field || jsonb_build_object(
            'condition', jsonb_build_object(
              'field', 'estado_civil',
              'equals', jsonb_build_array('casado', 'union_convivencial')
            )
          )
        ELSE field
      END AS field
    FROM fields
  ),
  fields_by_section AS (
    SELECT s_idx, jsonb_agg(field ORDER BY f_idx) AS arr
    FROM patched GROUP BY s_idx
  ),
  rebuilt_sections AS (
    SELECT b.idx, (b.seccion || jsonb_build_object('fields', fbs.arr)) AS seccion
    FROM base b
    JOIN fields_by_section fbs ON fbs.s_idx = b.idx
  ),
  rebuilt_array AS (
    SELECT jsonb_agg(seccion ORDER BY idx) AS arr FROM rebuilt_sections
  )
  SELECT arr INTO v_secciones FROM rebuilt_array;

  SELECT jsonb_agg(
    CASE
      WHEN seccion->>'title' = 'Documentación requerida' THEN
        seccion || jsonb_build_object(
          'fields',
          (seccion->'fields') || jsonb_build_array(
            jsonb_build_object(
              'name', 'comprobante_pago_matricula',
              'type', 'file',
              'label', 'Comprobante de pago de matrícula',
              'required', true,
              'hint', 'Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección "Voucher" y este campo se omitirá automáticamente.'
            )
          )
        )
      ELSE seccion
    END
  ) INTO v_secciones FROM jsonb_array_elements(v_secciones) AS seccion;

  UPDATE public.formularios
  SET schema = v_schema || jsonb_build_object('sections', v_secciones),
      schema_draft = NULL,
      schema_draft_at = NULL,
      updated_at = now()
  WHERE id = v_id;
END $$;
