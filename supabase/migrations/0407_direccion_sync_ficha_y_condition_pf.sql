-- ============================================================================
-- 0407 · DGG-127 §6 — dos fixes del auditor adversarial sobre la 0406
--
-- (1) `direccion` de renovación pasa a rama Persona física: la rama PJ ya
--     carga su domicilio en `domicilio_empresa` (required) — sin esta
--     condition el PJ cargaba DOS domicilios y la máscara del gestor los
--     concatenaba ("Av. Sede 123 Calle Falsa 456"). Localidad/CP quedan
--     comunes: para PJ completan la sede social (la máscara PJ ya los mapea).
--
-- (2) Los triggers de sync a la ficha armaban la dirección solo desde
--     calle/numero/piso/depto (+ fallback domicilio_empresa) y NUNCA leían
--     `datos->>'direccion'` — ejercitado en BD: una renovación PF dejaba la
--     ficha con localidad y CP pero direccion=NULL, y el prefill futuro
--     tampoco la devolvía. Se agrega el fallback en las DOS funciones
--     parcheando la definición viva (patrón verificado contra la BD antes de
--     escribir esta mig) con assert de que el replace surtió efecto.
-- ============================================================================

-- 1) Snapshot de renovación antes de tocar el schema.
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug = 'renovacion-rpac';

-- 2) direccion → condition Persona física (sections[2] = "Domicilio", fields[0]).
UPDATE public.formularios
SET schema = jsonb_set(
      schema,
      '{sections,2,fields,0}',
      (schema->'sections'->2->'fields'->0) ||
        '{"condition":{"field":"tipo_persona_solicitante","equals":"Persona física"}}'::jsonb
    ),
    updated_at = now()
WHERE slug = 'renovacion-rpac'
  AND schema->'sections'->2->>'title' = 'Domicilio'
  AND schema->'sections'->2->'fields'->0->>'name' = 'direccion';

-- 3) sync_submission_a_administracion: fallback a NEW.datos->>'direccion'.
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'sync_submission_a_administracion';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'sync_submission_a_administracion no existe';
  END IF;
  IF v_def LIKE '%NEW.datos->>''direccion''%' THEN
    RAISE NOTICE 'sync ya lee direccion — skip';
    RETURN;
  END IF;
  v_new := replace(
    v_def,
    'NULLIF(trim(NEW.datos->>''domicilio_empresa''), ''''));',
    'NULLIF(trim(NEW.datos->>''domicilio_empresa''), ''''));' || E'\n' ||
    '  -- DGG-127: renovación releva el domicilio en la key `direccion`.' || E'\n' ||
    '  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>''direccion''), ''''));'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'patrón domicilio_empresa no encontrado en sync_submission_a_administracion — revisar a mano';
  END IF;
  EXECUTE v_new;
END
$mig$;

-- 4) backfill_admin_desde_tramite_submission: mismo fallback (usa v_datos).
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'backfill_admin_desde_tramite_submission';
  IF v_def IS NULL THEN
    RAISE NOTICE 'backfill_admin_desde_tramite_submission no existe — skip';
    RETURN;
  END IF;
  IF v_def LIKE '%v_datos->>''direccion''%' THEN
    RAISE NOTICE 'backfill ya lee direccion — skip';
    RETURN;
  END IF;
  v_new := replace(
    v_def,
    'NULLIF(trim(v_datos->>''domicilio_empresa''), ''''));',
    'NULLIF(trim(v_datos->>''domicilio_empresa''), ''''));' || E'\n' ||
    '  -- DGG-127: renovación releva el domicilio en la key `direccion`.' || E'\n' ||
    '  v_direccion := COALESCE(v_direccion, NULLIF(trim(v_datos->>''direccion''), ''''));'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'patrón domicilio_empresa no encontrado en backfill_admin_desde_tramite_submission — revisar a mano';
  END IF;
  EXECUTE v_new;
END
$mig$;
