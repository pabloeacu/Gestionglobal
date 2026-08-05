-- ============================================================================
-- 0406 · DGG-127 (pedido Pablo 2026-08-05) — campos faltantes obligatorios
--
-- Inscripción (matriculacion-rpac): + Ciudad de nacimiento (rama PF, junto a
--   fecha de nacimiento/nacionalidad en "Datos personales").
-- Renovación (renovacion-rpac): + Fecha de nacimiento, Nacionalidad y Ciudad
--   de nacimiento (rama PF, en "Identificación" tras padre/madre) + sección
--   nueva "Domicilio" común a PF/PJ con Domicilio/Localidad/Código postal.
--   Keys `direccion`/`localidad`/`codigo_postal`: idénticas a las que ya
--   expone cliente_perfil_datos_formulario → prefill automático en el portal.
--
-- Todos required. La máscara del gestor (mascaraGestoria.ts) los muestra en
-- su bloque: domicilio en el principal, datos de nacimiento en "Información
-- adicional para pedido de certificado de antecedentes personales".
-- ============================================================================

-- 1) Snapshot (patrón 0397/0403/0404).
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac');

-- 2) matriculacion-rpac · ciudad_nacimiento tras nacionalidad
--    (sections[1] = "Datos personales"; nacionalidad está en fields[12]).
UPDATE public.formularios
SET schema = jsonb_insert(
      schema,
      '{sections,1,fields,13}',
      '{"name":"ciudad_nacimiento","type":"text","label":"Ciudad de nacimiento","required":true,"placeholder":"Ej: La Plata","condition":{"field":"tipo_persona_solicitante","equals":"Persona física"}}'::jsonb
    ),
    updated_at = now()
WHERE slug = 'matriculacion-rpac'
  AND schema->'sections'->1->'fields'->12->>'name' = 'nacionalidad'
  AND NOT (schema::text LIKE '%ciudad_nacimiento%');

-- 3) renovacion-rpac · fecha_nacimiento + nacionalidad + ciudad_nacimiento
--    tras madre_apellido_nombre (sections[1] = "Identificación"; madre está
--    en fields[5]). Inserts encadenados en 6, 7 y 8 → orden final correcto.
UPDATE public.formularios
SET schema = jsonb_insert(
      jsonb_insert(
        jsonb_insert(
          schema,
          '{sections,1,fields,6}',
          '{"name":"fecha_nacimiento","type":"date","label":"Fecha de nacimiento","required":true,"condition":{"field":"tipo_persona_solicitante","equals":"Persona física"}}'::jsonb
        ),
        '{sections,1,fields,7}',
        '{"name":"nacionalidad","type":"text","label":"Nacionalidad","required":true,"placeholder":"Ej: Argentina","condition":{"field":"tipo_persona_solicitante","equals":"Persona física"}}'::jsonb
      ),
      '{sections,1,fields,8}',
      '{"name":"ciudad_nacimiento","type":"text","label":"Ciudad de nacimiento","required":true,"placeholder":"Ej: La Plata","condition":{"field":"tipo_persona_solicitante","equals":"Persona física"}}'::jsonb
    ),
    updated_at = now()
WHERE slug = 'renovacion-rpac'
  AND schema->'sections'->1->'fields'->5->>'name' = 'madre_apellido_nombre'
  AND NOT (schema::text LIKE '%ciudad_nacimiento%');

-- 4) renovacion-rpac · sección "Domicilio" común, insertada después de
--    "Identificación" (pasa a ser sections[2]).
UPDATE public.formularios
SET schema = jsonb_insert(
      schema,
      '{sections,2}',
      '{"title":"Domicilio","fields":[
        {"name":"direccion","type":"text","label":"Domicilio","required":true,"placeholder":"Calle y número","hint":"Calle, número, piso y departamento si corresponde."},
        {"name":"localidad","type":"text","label":"Localidad","required":true},
        {"name":"codigo_postal","type":"text","label":"Código postal","required":true}
      ]}'::jsonb
    ),
    updated_at = now()
WHERE slug = 'renovacion-rpac'
  AND schema->'sections'->1->>'title' = 'Identificación'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(schema->'sections') s
    WHERE s->>'title' = 'Domicilio'
  );
