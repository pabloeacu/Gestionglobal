-- ============================================================================
-- 0408 · E-GG-173 (reporte Pablo 2026-08-06) — campo "Adjuntar archivo"
-- fantasma en curso-formacion
--
-- En la sección "Tus datos" (tras Provincia) apareció un campo file `file_10`
-- con label "Adjuntar archivo", opcional. Forense: name autogenerado del
-- BUILDER de gerencia — quedó pegado por accidente en una sesión de edición
-- del 27/07 (guardado posterior al snapshot v4) y pasó inadvertido por ser
-- opcional. 0 usos (ningún adjunto con field_name='file_10', ninguna
-- submission con la key). El único upload legítimo del form es
-- `comprobante_pago_inscripcion` en la sección "Pago". El barrido por regex
-- de names autogenerados confirmó que es el ÚNICO caso en toda la plataforma.
-- ============================================================================

-- 1) Snapshot del schema actual.
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug = 'curso-formacion';

-- 2) Eliminar el campo file_10 de todas las secciones (solo existe en una).
UPDATE public.formularios f
SET schema = jsonb_set(
      f.schema,
      '{sections}',
      (
        SELECT jsonb_agg(
                 jsonb_set(
                   sec,
                   '{fields}',
                   COALESCE(
                     (SELECT jsonb_agg(fld ORDER BY ord)
                        FROM jsonb_array_elements(sec->'fields') WITH ORDINALITY t(fld, ord)
                       WHERE fld->>'name' IS DISTINCT FROM 'file_10'),
                     '[]'::jsonb
                   )
                 )
                 ORDER BY sord
               )
          FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY s(sec, sord)
      ),
      false
    ),
    updated_at = now()
WHERE f.slug = 'curso-formacion'
  AND f.schema::text LIKE '%file_10%';
