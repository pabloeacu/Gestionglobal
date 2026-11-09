-- 0680_dgg246_obs3456_forms_xlsx_nota_encabezado.sql
-- DGG-246 · Observaciones 3, 4, 5 y 6 de José Luis (formularios públicos RPAC/DDJJ).
--
-- Obs 3/5/6 — La planilla de "Listado de consorcios administrados (planilla
--   completa)" debe aceptar SÓLO Excel (.xlsx): hoy acepta cualquier cosa y
--   llegaron PDFs ("RENOVACION 2026.xlsx - Hoja1.pdf", "factura_...pdf"), que NO
--   sirven para presentar al RPAC. + Agregar una nota de que es obligatorio subir
--   en el MISMO formato/estructura que la planilla modelo descargable.
--   → `accept:[".xlsx"]` + hint reforzado en `planilla_consorcios_completa` de los
--     3 formularios (ddjj-anual, renovacion-rpac, matriculacion-rpac) + subtitle
--     en la sección "Documentación requerida" de la DDJJ (que no tenía).
--   NOTA: el `accept` sólo filtra el picker nativo; la restricción REAL (rechazo
--   por-campo en drag&drop / payload crafteado) se hace en el runner
--   (FormularioRunner) y en el edge (submit-formulario), que ahora miran
--   `field.accept`. Esta migración es la capa de datos de ese combo.
--
-- Obs 4 — El bloque "Encabezado" del formulario DDJJ ("Archivo para descargar
--   (sin archivo cargado)" + "Adjuntar archivo"). JL: "¿para qué es?".
--   Diagnóstico (E-GG-268): son 5 campos BASURA con nombres autogenerados
--   (textarea_9, separator_10, heading_12, file_download_13, file_14) que quedaron
--   pegados por error al armar el formulario en el builder y nunca se borraron.
--   El runner renderiza TODOS los campos del schema → se mostraban en el
--   formulario PÚBLICO real, no sólo en el preview. → se eliminan del schema.
--   (Barrido §6: son los ÚNICOS campos basura del catálogo; problema contenido.)
--
-- Sólo cambia `formularios.schema` (jsonb). Snapshot previo en
-- `formulario_versiones` (regla de oro del motor, patrón de 0522). No toca RLS
-- ni grants. Las submissions existentes no se tocan.

-- 1) Snapshot reversible de las versiones vigentes
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT max(v.version_num) FROM public.formulario_versiones v WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
FROM public.formularios f
WHERE f.slug IN ('ddjj-anual', 'renovacion-rpac', 'matriculacion-rpac');

-- 2) Edición del schema: para cada sección, reconstruir sus campos
--    (a) quitar los 5 campos basura (sólo existen en ddjj-anual/Identificación)
--    (b) en planilla_consorcios_completa: accept .xlsx + hint reforzado
--    y, sólo en la DDJJ, poner subtitle en "Documentación requerida".
UPDATE public.formularios f
SET schema = jsonb_set(f.schema, '{sections}', (
  SELECT jsonb_agg(
    (CASE
       WHEN f.slug = 'ddjj-anual' AND sec->>'title' = 'Documentación requerida'
       THEN jsonb_set(sec, '{subtitle}', to_jsonb(
              'Descargá la planilla modelo, completala en tu computadora con los datos de los consorcios del período y volvé a subirla. Importante: tiene que ser el mismo archivo Excel (.xlsx), con la misma estructura e información que la planilla modelo. Un PDF u otro formato no sirve para presentar al RPAC.'::text))
       ELSE sec
     END)
    || jsonb_build_object('fields', COALESCE((
         SELECT jsonb_agg(
           CASE
             WHEN fld->>'name' = 'planilla_consorcios_completa'
             THEN fld || jsonb_build_object(
                    'accept', jsonb_build_array('.xlsx'),
                    'hint', 'Subí la MISMA planilla modelo que descargaste arriba, ya completa y en formato Excel (.xlsx). Es obligatorio: un PDF u otro formato no sirve para presentar al RPAC.')
             ELSE fld
           END
           ORDER BY ord)
         FROM jsonb_array_elements(sec->'fields') WITH ORDINALITY AS t(fld, ord)
         WHERE fld->>'name' NOT IN ('textarea_9','separator_10','heading_12','file_download_13','file_14')
       ), '[]'::jsonb))
    ORDER BY sord
  )
  FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY AS s(sec, sord)
))
WHERE f.slug IN ('ddjj-anual', 'renovacion-rpac', 'matriculacion-rpac');
