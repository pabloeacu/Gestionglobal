-- ============================================================================
-- 0404 · DGG-126 (pedido Pablo 2026-08-05) — switch PF/PJ preseleccionado
--
-- El radio `tipo_persona_solicitante` de los forms RPAC arrancaba sin valor:
-- ninguna rama visible, el solicitante completaba "a ciegas" los campos
-- comunes y el freno del required recién aparecía al enviar — con riesgo de
-- presentaciones con información incorrecta. Como la enorme mayoría de las
-- inscripciones son personas físicas, el switch arranca en "Persona física"
-- con su formulario completo visible; el solicitante lo cambia si aplica.
-- En el portal, el prefill del perfil pisa este default cuando el cliente es
-- persona jurídica (CUIT 30/33/34 — doctrina DGG-123).
--
-- Aplica a los 3 forms con switch: matriculacion-rpac, renovacion-rpac y
-- certificado-rpac (mismo motor, mismo riesgo). El runner aplica `default`
-- desde DGG-126 (FormularioRunner: estado inicial desde el schema).
-- ============================================================================

-- 1) Snapshot de los schemas actuales (patrón mig 0397/0403).
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac', 'certificado-rpac');

-- 2) default = "Persona física" en el radio tipo_persona_solicitante.
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
                                WHEN fld->>'name' = 'tipo_persona_solicitante'
                                     AND fld->>'type' = 'radio'
                                THEN fld || '{"default": "Persona física"}'::jsonb
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
WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac', 'certificado-rpac');
