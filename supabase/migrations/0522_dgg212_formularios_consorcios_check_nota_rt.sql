-- 0522_dgg212_formularios_consorcios_check_nota_rt.sql
-- DGG-212 — 2 ajustes a los formularios RPAC (relevamiento JL):
--  (1) Bloque "Listado de consorcios": check "Aún no administro consorcios". Si se
--      tilda, el runner adjunta automáticamente la planilla modelo EN BLANCO
--      (prop declarativa `auto_attach`, resuelta en FormularioRunner) → gestoría
--      siempre recibe el archivo obligatorio para el RPAC, sin que el cliente lo
--      vea. El upload pasa a requerido (salvo que tilde el check → se auto-adjunta).
--      Aplica a `matriculacion-rpac` y `renovacion-rpac`.
--  (2) `renovacion-rpac`: nota condicional (sólo Persona jurídica) aclarando que el
--      DNI y el certificado del curso de actualización son del RESPONSABLE TÉCNICO
--      (la persona física matriculada que responde por la sociedad), no de la empresa.
--
-- Sólo cambia `formularios.schema` (jsonb). Snapshot previo en
-- `formulario_versiones` (regla de oro del motor de formularios). El auto-adjunto
-- NO toca la edge `submit-formulario` (R7): viaja por el flujo normal de adjuntos.

-- 1) Snapshot de las versiones vigentes (reversible)
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT max(v.version_num) FROM public.formulario_versiones v WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
FROM public.formularios f
WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac');

-- 2) Edición del schema (match por título de sección + nombre de campo)
UPDATE public.formularios f
SET schema = jsonb_set(f.schema, '{sections}', (
  SELECT jsonb_agg(
    CASE
      -- Sección del listado de consorcios (ambos forms tienen una, con título distinto)
      WHEN sec->>'title' IN ('Listado de consorcios (si ya estás administrando)', 'Listado de consorcios actualizado')
      THEN jsonb_set(
             jsonb_set(sec, '{subtitle}', to_jsonb('Si administrás consorcios, descargá la planilla modelo, completala y subila. Si todavía no administrás ninguno, marcá la casilla.'::text)),
             '{fields}',
             (jsonb_build_array(jsonb_build_object(
                'name', 'no_administra_consorcios',
                'type', 'checkbox',
                'label', 'Aún no administro consorcios',
                'hint', 'Marcá esta opción si todavía no tenés consorcios a tu cargo; no necesitás subir el listado.'
              )))
             ||
             (SELECT jsonb_agg(
                CASE
                  WHEN fld->>'name' = 'planilla_consorcios_modelo'
                    THEN fld || jsonb_build_object('condition', jsonb_build_object(
                           'field', 'no_administra_consorcios', 'equals', jsonb_build_array('', 'false')))
                  WHEN fld->>'name' = 'planilla_consorcios_completa'
                    THEN fld || jsonb_build_object(
                           'required', true,
                           'auto_attach', jsonb_build_object(
                             'when_field', 'no_administra_consorcios',
                             'when_equals', true,
                             'source_url', 'https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/formulario-descargas/ddjj-anual/datos-de-consorcios-modelo.xlsx',
                             'filename', 'Datos de Consorcios - Gestión Global.xlsx'))
                  ELSE fld
                END
              ) FROM jsonb_array_elements(sec->'fields') fld)
           )
      -- Documentación de renovación: nota condicional "del Responsable Técnico" (PJ)
      WHEN sec->>'title' = 'Documentación requerida' AND f.slug = 'renovacion-rpac'
      THEN jsonb_set(sec, '{fields}',
             (jsonb_build_array(jsonb_build_object(
                'name', 'nota_doc_responsable_tecnico',
                'type', 'html',
                'condition', jsonb_build_object('field', 'tipo_persona_solicitante', 'equals', 'Persona jurídica'),
                'label', '<div style="border-left:4px solid #C46A10;background:#FFF7ED;padding:12px 16px;border-radius:8px;"><p style="margin:0;color:#7c2d12;font-size:14px;line-height:1.6;"><strong>Importante (persona jurídica):</strong> El DNI y el certificado del curso de actualización que se piden en esta sección son los del <strong>Responsable Técnico</strong> —la persona física matriculada que responde por la sociedad—, no de la empresa.</p></div>'
              )))
             || (sec->'fields')
           )
      ELSE sec
    END
  )
  FROM jsonb_array_elements(f.schema->'sections') sec
))
WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac');
