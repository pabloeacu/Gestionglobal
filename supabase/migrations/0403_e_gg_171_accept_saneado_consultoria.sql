-- ============================================================================
-- 0403 · E-GG-171 (§6 ultra del merge E-GG-170) — accept custom `image/*`
--
-- El form vivo `consultoria-juridica` definía accept
-- ["application/pdf","image/*"] en sus 2 campos file. `image/*` admite HEIC →
-- Safari iOS NO transcodifica la foto de cámara (solo lo hace cuando el accept
-- no admite HEIC) → el runner y el edge la rechazan siempre (whitelist del
-- bucket form-adjuntos sin heic) → campo required imposible de completar desde
-- un iPhone con cámara en formato default.
--
-- El fix principal es de CÓDIGO (sanearAccept en FormularioRunner.tsx, cubre
-- cualquier accept futuro del builder); este UPDATE es el cinturón de datos:
-- deja el schema vivo con extensiones explícitas de la whitelist.
-- ============================================================================

-- 1) Snapshot del schema actual (mismo patrón que la mig 0397).
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug = 'consultoria-juridica';

-- 2) Reemplazar el accept de TODO campo file cuyo accept contenga 'image/*'
--    por la lista explícita de extensiones de la whitelist del bucket.
UPDATE public.formularios f
SET schema = jsonb_set(
      f.schema,
      '{sections}',
      (
        SELECT jsonb_agg(
                 jsonb_set(
                   sec,
                   '{fields}',
                   (
                     SELECT jsonb_agg(
                              CASE
                                WHEN fld->>'type' = 'file'
                                     AND fld ? 'accept'
                                     AND fld->'accept' @> '"image/*"'::jsonb
                                THEN jsonb_set(
                                       fld,
                                       '{accept}',
                                       '[".pdf",".jpg",".jpeg",".png",".webp"]'::jsonb
                                     )
                                ELSE fld
                              END
                              ORDER BY ord
                            )
                       FROM jsonb_array_elements(sec->'fields') WITH ORDINALITY AS t(fld, ord)
                   )
                 )
                 ORDER BY sord
               )
          FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY AS s(sec, sord)
      ),
      false
    ),
    updated_at = now()
WHERE f.slug = 'consultoria-juridica'
  AND f.schema::text LIKE '%image/*%';
