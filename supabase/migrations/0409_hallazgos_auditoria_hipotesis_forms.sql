-- ============================================================================
-- 0409 · E-GG-173 (auditoría §6 multi-hipótesis posterior, 11 agentes) —
-- 4 hallazgos confirmados aplicados. El 5º (costos de curso-formacion sin
-- importe con comprobante required) queda para decisión de Pablo: el arancel
-- de Formación no está definido en ningún lado (cursos.precio_lista NULL).
--
-- (a) schema_draft fantasma en curso-formacion: el autosave del builder de la
--     sesión QA de E-GG-173 persistió un draft con un checkbox_10 "Acepto…"
--     — un "Guardar versión" lo habría publicado. Se anula el draft (la
--     lección va al checklist de limpieza QA: schema_draft en 0).
-- (b) certificado-rpac: el radio "urgencia" mostraba al público el value
--     interno crudo "5_dias_habiles" → etiqueta humana. Nada consume el
--     value (verificado); históricos conservan el dato viejo como display.
-- (c) matriculacion-rpac: estado_civil con options snake_case crudas
--     ("soltero", "union_convivencial") visibles al solicitante y al gestor
--     → etiquetas humanas, actualizando EN EL MISMO paso las conditions de
--     los campos del cónyuge que referencian esos valores.
-- (d) total_envios de matriculacion-rpac inflado (5 vs 2 reales): el trigger
--     de contador es solo AFTER INSERT — las limpiezas QA decrementaban
--     submissions pero no el contador. Recompute global + trigger de
--     decremento simétrico (SECURITY DEFINER + search_path, R17).
-- ============================================================================

-- Snapshot de los schemas que se tocan.
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug IN ('certificado-rpac', 'matriculacion-rpac');

-- (a) Draft fantasma fuera.
UPDATE public.formularios
SET schema_draft = NULL, schema_draft_at = NULL
WHERE slug = 'curso-formacion'
  AND schema_draft::text LIKE '%checkbox_10%';

-- (b) urgencia: value crudo → etiqueta humana.
UPDATE public.formularios f
SET schema = jsonb_set(
      f.schema, '{sections}',
      (SELECT jsonb_agg(
                jsonb_set(sec, '{fields}',
                  (SELECT jsonb_agg(
                            CASE WHEN fld->>'name' = 'urgencia' AND fld->>'type' = 'radio'
                                 THEN jsonb_set(fld, '{options}', '["5 días hábiles"]'::jsonb)
                                 ELSE fld END
                            ORDER BY ord)
                     FROM jsonb_array_elements(sec->'fields') WITH ORDINALITY t(fld, ord)))
                ORDER BY sord)
         FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY s(sec, sord)),
      false),
    updated_at = now()
WHERE f.slug = 'certificado-rpac'
  AND f.schema::text LIKE '%5_dias_habiles%';

-- (c) estado_civil: options humanas + conditions del cónyuge en el mismo paso.
UPDATE public.formularios f
SET schema = jsonb_set(
      f.schema, '{sections}',
      (SELECT jsonb_agg(
                jsonb_set(sec, '{fields}',
                  (SELECT jsonb_agg(
                            CASE
                              WHEN fld->>'name' = 'estado_civil' AND fld->>'type' = 'select'
                              THEN jsonb_set(fld, '{options}',
                                     '["Soltero/a","Casado/a","Divorciado/a","Viudo/a","Unión convivencial"]'::jsonb)
                              WHEN fld->'condition'->>'field' = 'estado_civil'
                              THEN jsonb_set(fld, '{condition,equals}',
                                     '["Casado/a","Unión convivencial"]'::jsonb)
                              ELSE fld
                            END
                            ORDER BY ord)
                     FROM jsonb_array_elements(sec->'fields') WITH ORDINALITY t(fld, ord)))
                ORDER BY sord)
         FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY s(sec, sord)),
      false),
    updated_at = now()
WHERE f.slug = 'matriculacion-rpac'
  AND f.schema::text LIKE '%"soltero"%';

-- (d) Contador fiel: recompute global + decremento simétrico.
UPDATE public.formularios f
SET total_envios = (SELECT count(*) FROM public.formulario_submissions s WHERE s.formulario_id = f.id)
WHERE f.total_envios IS DISTINCT FROM
      (SELECT count(*) FROM public.formulario_submissions s WHERE s.formulario_id = f.id);

CREATE OR REPLACE FUNCTION public.decrementar_envios_formulario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.formularios
  SET total_envios = GREATEST(0, COALESCE(total_envios, 0) - 1)
  WHERE id = OLD.formulario_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_subm_decrementa_form ON public.formulario_submissions;
CREATE TRIGGER trg_subm_decrementa_form
AFTER DELETE ON public.formulario_submissions
FOR EACH ROW EXECUTE FUNCTION public.decrementar_envios_formulario();
