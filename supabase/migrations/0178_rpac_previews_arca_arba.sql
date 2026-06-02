-- ============================================================================
-- 0178 · JL-PREVIEW · Aplicar previews a constancia_inscripcion_arca y
--                    constancia_arba_iibb en matriculacion-rpac y
--                    renovacion-rpac.
--
-- Las imágenes de ejemplo están servidas como assets estáticos del repo
-- (carpeta `public/form-previews/` que Vercel sirve desde la raíz). Los
-- nombres del archivo "real" que va debajo de la imagen son los que el
-- usuario espera ver subir.
--
-- Auditoría transversal: ambos formularios (matriculacion y renovacion)
-- tienen los mismos 2 campos con los mismos `name` técnicos
-- (`constancia_inscripcion_arca` + `constancia_arba_iibb`), así que el
-- DO block recorre los dos slugs.
--
-- Frontend: el `FormularioRunner` lee `field.preview` y renderiza el ojito
-- con popover (`FieldPreviewEye`). No requiere cambios de schema en BD —
-- es JSON dentro de `formularios.schema`.
-- ============================================================================

DO $$
DECLARE
  v_slug         text;
  v_schema       jsonb;
  v_new_sections jsonb;
  v_new_fields   jsonb;
  sec            jsonb;
  fld            jsonb;
  v_preview_arca jsonb := jsonb_build_object(
    'url',      '/form-previews/constancia-inscripcion-arca-ejemplo.png',
    'filename', 'Constancia de Inscripción ARCA (Monotributo).pdf',
    'alt',      'Ejemplo de Constancia de Inscripción ARCA — Monotributo, mostrando el código de actividad 682010 Servicios de administración de consorcios de edificios.'
  );
  v_preview_arba jsonb := jsonb_build_object(
    'url',      '/form-previews/constancia-arba-iibb-ejemplo.png',
    'filename', 'Constancia ARBA Ingresos Brutos.pdf',
    'alt',      'Ejemplo de Constancia ARBA Ingresos Brutos — actividad principal 682010 Servicios de administración de consorcios de edificios.'
  );
BEGIN
  FOREACH v_slug IN ARRAY ARRAY['matriculacion-rpac', 'renovacion-rpac']
  LOOP
    SELECT schema INTO v_schema FROM public.formularios WHERE slug = v_slug;
    IF v_schema IS NULL THEN
      RAISE NOTICE 'Formulario % no existe, skip', v_slug;
      CONTINUE;
    END IF;
    v_new_sections := '[]'::jsonb;
    FOR sec IN SELECT * FROM jsonb_array_elements(v_schema->'sections') LOOP
      v_new_fields := '[]'::jsonb;
      FOR fld IN SELECT * FROM jsonb_array_elements(sec->'fields') LOOP
        IF fld->>'name' = 'constancia_inscripcion_arca' THEN
          v_new_fields := v_new_fields || jsonb_build_array(
            fld || jsonb_build_object('preview', v_preview_arca)
          );
        ELSIF fld->>'name' = 'constancia_arba_iibb' THEN
          v_new_fields := v_new_fields || jsonb_build_array(
            fld || jsonb_build_object('preview', v_preview_arba)
          );
        ELSE
          v_new_fields := v_new_fields || jsonb_build_array(fld);
        END IF;
      END LOOP;
      v_new_sections := v_new_sections || jsonb_build_array(
        jsonb_set(sec, '{fields}', v_new_fields)
      );
    END LOOP;
    UPDATE public.formularios
       SET schema = jsonb_set(v_schema, '{sections}', v_new_sections, true),
           updated_at = now()
     WHERE slug = v_slug;
    RAISE NOTICE 'Previews aplicadas en %', v_slug;
  END LOOP;
END $$;

-- Mig complementaria: en renovacion-rpac el campo ARCA se llama
-- `constancia_arca_actualizada` (es de actualización, no de inscripción
-- inicial). Mismo documento → mismo preview.
DO $$
DECLARE
  v_schema jsonb; v_new_sections jsonb := '[]'::jsonb; v_new_fields jsonb;
  sec jsonb; fld jsonb;
  v_preview jsonb := jsonb_build_object(
    'url', '/form-previews/constancia-inscripcion-arca-ejemplo.png',
    'filename', 'Constancia de Inscripción ARCA (Monotributo).pdf',
    'alt', 'Ejemplo de Constancia de Inscripción ARCA — Monotributo, mostrando el código de actividad 682010.'
  );
BEGIN
  SELECT schema INTO v_schema FROM public.formularios WHERE slug = 'renovacion-rpac';
  FOR sec IN SELECT * FROM jsonb_array_elements(v_schema->'sections') LOOP
    v_new_fields := '[]'::jsonb;
    FOR fld IN SELECT * FROM jsonb_array_elements(sec->'fields') LOOP
      IF fld->>'name' = 'constancia_arca_actualizada' THEN
        v_new_fields := v_new_fields || jsonb_build_array(fld || jsonb_build_object('preview', v_preview));
      ELSE
        v_new_fields := v_new_fields || jsonb_build_array(fld);
      END IF;
    END LOOP;
    v_new_sections := v_new_sections || jsonb_build_array(jsonb_set(sec, '{fields}', v_new_fields));
  END LOOP;
  UPDATE public.formularios SET schema = jsonb_set(v_schema, '{sections}', v_new_sections, true), updated_at = now() WHERE slug = 'renovacion-rpac';
END $$;
