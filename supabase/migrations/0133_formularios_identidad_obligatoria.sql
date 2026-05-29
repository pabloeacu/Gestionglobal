-- ============================================================================
-- Migration: 0133_formularios_identidad_obligatoria
-- Fecha: 2026-05-29
-- DGG-XX · Política unificada (2026-05-29): TODOS los formularios públicos
-- deben pedir como obligatorios los 6 campos de identidad del cliente:
--   apellido · nombre · dni · cuit · email · celular
-- Estos keys son los que la plataforma usa para cross-match con
-- administraciones (mig 0115) y para auto-fill desde el perfil cuando el
-- cliente entra logueado. Apellido y Nombre van por separado para poder
-- normalizar.
--
-- Estrategia:
--   1) Para cada formulario activo, asegurar que en la sección 0 estén los
--      6 fields con required:true. Si ya existen por nombre exacto → fuerza
--      required:true. Si no existen → los agrega al principio de la sección.
--   2) Aliases legacy (apellido_nombre, telefono, correo_electronico) se
--      conservan en el schema (para no romper submissions viejas) pero pasan
--      a required:false. La submission nueva usará apellido/nombre/celular.
--   3) El title de la sección 0 pasa a "Identificación" si estaba vacío.
-- ============================================================================

-- Helper interno: dado un schema jsonb, devuelve el schema patcheado con los
-- 6 campos de identidad como required en la sección 0. Idempotente.
CREATE OR REPLACE FUNCTION private._formulario_patch_identidad(p_schema jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_sections jsonb;
  v_section0 jsonb;
  v_fields   jsonb;
  v_new_fields jsonb := '[]'::jsonb;
  v_existing_names text[];
  v_identidad jsonb := '[
    {"name":"apellido","type":"text","label":"Apellido","required":true,"placeholder":"García"},
    {"name":"nombre","type":"text","label":"Nombre","required":true,"placeholder":"Diego"},
    {"name":"dni","type":"text","label":"DNI","required":true,"placeholder":"Sin puntos"},
    {"name":"cuit","type":"text","label":"CUIT/CUIL","required":true,"placeholder":"11 dígitos sin guiones"},
    {"name":"email","type":"email","label":"Correo electrónico","required":true,"placeholder":"tu@correo.com"},
    {"name":"celular","type":"tel","label":"Celular","required":true,"placeholder":"+54 11 5555-1234"}
  ]'::jsonb;
  v_aliases_legacy text[] := ARRAY[
    'apellido_nombre',        -- alias de apellido + nombre juntos
    'nombre_completo',
    'razon_social',
    'telefono',               -- alias de celular
    'tel',
    'correo',                 -- alias de email
    'correo_electronico',
    'cuit_cuil',
    'cuil',
    'documento',
    'numero_documento'
  ];
  v_field jsonb;
  v_existing jsonb;
  v_name text;
BEGIN
  v_sections := COALESCE(p_schema -> 'sections', '[]'::jsonb);
  IF jsonb_array_length(v_sections) = 0 THEN
    -- Schema vacío: arrancamos con una sección Identificación con los 6.
    v_section0 := jsonb_build_object(
      'title', 'Identificación',
      'subtitle', 'Datos obligatorios para identificarte como cliente.',
      'fields', v_identidad
    );
    RETURN jsonb_set(p_schema, '{sections}', jsonb_build_array(v_section0));
  END IF;

  v_section0 := v_sections -> 0;
  v_fields   := COALESCE(v_section0 -> 'fields', '[]'::jsonb);

  -- Construimos nuevo array de fields: primero los 6 identidad (mergeados con
  -- los existentes si tenían placeholder/hint), después los que ya estaban
  -- excluyendo aquellos que coincidan por nombre con los 6 identidad.
  v_existing_names := ARRAY(
    SELECT (elem ->> 'name') FROM jsonb_array_elements(v_fields) AS elem
  );

  -- Append los 6 identidad (priorizando el placeholder/hint si ya existían)
  FOR v_field IN SELECT * FROM jsonb_array_elements(v_identidad) LOOP
    v_name := v_field ->> 'name';
    SELECT elem INTO v_existing
      FROM jsonb_array_elements(v_fields) AS elem
     WHERE elem ->> 'name' = v_name
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      -- Mergea: preserva hint/placeholder existentes, fuerza required:true
      v_field := v_field
        || COALESCE(jsonb_build_object('placeholder', v_existing -> 'placeholder'), '{}'::jsonb)
        || COALESCE(jsonb_build_object('hint', v_existing -> 'hint'), '{}'::jsonb)
        || jsonb_build_object('required', true);
      -- Limpia placeholder/hint nulos que el coalesce dejó
      IF v_field ? 'placeholder' AND (v_field -> 'placeholder') = 'null'::jsonb THEN
        v_field := v_field - 'placeholder';
      END IF;
      IF v_field ? 'hint' AND (v_field -> 'hint') = 'null'::jsonb THEN
        v_field := v_field - 'hint';
      END IF;
    END IF;
    v_new_fields := v_new_fields || v_field;
  END LOOP;

  -- Append el resto de campos preexistentes (que no coincidan con los 6
  -- identidad). Si son aliases legacy, forzar required:false.
  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields) LOOP
    v_name := v_field ->> 'name';
    IF v_name = ANY (ARRAY['apellido','nombre','dni','cuit','email','celular']) THEN
      CONTINUE;
    END IF;
    IF v_name = ANY (v_aliases_legacy) THEN
      v_field := v_field || jsonb_build_object('required', false);
    END IF;
    v_new_fields := v_new_fields || v_field;
  END LOOP;

  -- Reconstruye sección 0
  v_section0 := jsonb_set(v_section0, '{fields}', v_new_fields);
  -- Title vacío → "Identificación"
  IF COALESCE(v_section0 ->> 'title', '') = '' THEN
    v_section0 := jsonb_set(v_section0, '{title}', '"Identificación"'::jsonb);
  END IF;

  v_sections := jsonb_set(v_sections, '{0}', v_section0);
  RETURN jsonb_set(p_schema, '{sections}', v_sections);
END;
$$;

-- Aplica el patch a todos los formularios (incluso inactivos: cuando se
-- reactiven ya estarán al día).
UPDATE public.formularios
SET schema = private._formulario_patch_identidad(schema),
    updated_at = NOW();

-- Cleanup: no queremos la función pública. La dejamos privada para reuso
-- futuro si vuelve a hacerse un patch masivo.
COMMENT ON FUNCTION private._formulario_patch_identidad(jsonb) IS
  'Patch idempotente: asegura los 6 campos identidad (apellido, nombre, dni, cuit, email, celular) como required en sección 0 de un schema de formulario. Aliases legacy quedan como required:false.';
