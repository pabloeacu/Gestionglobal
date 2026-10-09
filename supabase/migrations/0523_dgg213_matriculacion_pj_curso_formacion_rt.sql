-- 0523_dgg213_matriculacion_pj_curso_formacion_rt.sql
-- DGG-213 (relevamiento JL, pestaña "PARA VER", item 1):
--   "Inscripción Persona Jurídica > Lo del Representante técnico tendría que estar
--    igual que en la renovación con la salvedad de que debe subir el Curso de Formación."
--
-- En matriculacion-rpac, la rama Persona jurídica de "Documentación requerida" ya
-- pide el DNI del representante técnico (dni_representantes_tecnicos) pero NO pedía
-- el certificado del Curso de Formación del RT (el campo certificado_curso_administradores
-- estaba condicionado sólo a Persona física). Agregamos:
--   (a) nota condicional (PJ) aclarando que DNI + Curso de Formación son del RESPONSABLE
--       TÉCNICO (persona física matriculada), no de la empresa — espejo de la de renovación
--       (DGG-212) pero referida al Curso de Formación (no al de actualización).
--   (b) campo file 'certificado_curso_formacion_rt' (PJ, requerido).
--
-- Sólo cambia formularios.schema (jsonb). Snapshot previo en formulario_versiones
-- (regla de oro). No toca la edge submit-formulario (R7): nota=html, cert=file, ambos
-- ya soportados por FormularioRunner. Sin cambios de frontend.

-- 1) Snapshot de la versión vigente (reversible)
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT max(v.version_num) FROM public.formulario_versiones v WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
FROM public.formularios f
WHERE f.slug = 'matriculacion-rpac';

-- 2) Edición del schema
UPDATE public.formularios f
SET schema = jsonb_set(f.schema, '{sections}', (
  SELECT jsonb_agg(
    CASE
      WHEN sec->>'title' = 'Documentación requerida'
      THEN jsonb_set(sec, '{fields}',
             jsonb_build_array(jsonb_build_object(
               'name','nota_doc_responsable_tecnico',
               'type','html',
               'condition', jsonb_build_object('field','tipo_persona_solicitante','equals','Persona jurídica'),
               'label','<div style="border-left:4px solid #C46A10;background:#FFF7ED;padding:12px 16px;border-radius:8px;"><p style="margin:0;color:#7c2d12;font-size:14px;line-height:1.6;"><strong>Importante (persona jurídica):</strong> El DNI y el certificado del <strong>Curso de Formación</strong> que se piden en esta sección son los del <strong>Responsable Técnico</strong> —la persona física matriculada que responde por la sociedad—, no de la empresa.</p></div>'
             ))
             || (sec->'fields')
             || jsonb_build_array(jsonb_build_object(
               'name','certificado_curso_formacion_rt',
               'type','file',
               'label','Certificado del Curso de formación del Representante Técnico',
               'required', true,
               'condition', jsonb_build_object('field','tipo_persona_solicitante','equals','Persona jurídica')
             ))
           )
      ELSE sec
    END
  )
  FROM jsonb_array_elements(f.schema->'sections') sec
))
WHERE f.slug = 'matriculacion-rpac';
