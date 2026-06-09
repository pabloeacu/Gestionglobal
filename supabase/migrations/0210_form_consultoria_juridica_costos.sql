-- 0210 · F5 (Lista JL) · Bloque de costos en el formulario de consultoría jurídica
--
-- JL: el formulario público `consultoria-juridica` NO mostraba los costos, a
-- diferencia de los 4 formularios RPAC (matriculación / renovación / certificado
-- / DDJJ) que ya tienen el bloque `costos_info` "Costos del trámite". Era un
-- hueco de paridad entre formularios.
--
-- Pablo (F5): dos tarifas alineadas al campo `requiere_analisis` que el form YA
-- pregunta ("¿Requiere análisis de actas o reglamentos?"):
--   · Consulta jurídica .................................... $20.000
--   · Consulta con análisis de actas o reglamentos ......... $36.000
-- El servicio del catálogo (juridico_consulta, precio $25.000) NO se toca: el
-- bloque es informativo (igual que en los otros formularios).
--
-- Inserción quirúrgica del bloque en la sección "Pago", antes de "Adjuntar
-- comprobante de pago" (mismo patrón visual que el resto). Preserva todos los
-- campos existentes. Idempotente: si ya hubiera un bloque costos_info, no hace
-- nada. El bloque costos_info es presentacional (el runner lo excluye de
-- validación/submission) → no requiere cambios de frontend.

DO $f5$
DECLARE
  v_id     uuid;
  v_schema jsonb;
  v_ya     boolean;
  v_block  jsonb := jsonb_build_object(
    'name',  'costos_consulta_juridica',
    'type',  'costos_info',
    'label', 'Costos del trámite',
    'hint',  'Honorarios de la consulta jurídica.',
    'costos', jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object(
          'label',  'Consulta jurídica',
          'precio', '$20.000,00',
          'nota',   'Consulta sin análisis de documentación.'
        ),
        jsonb_build_object(
          'label',  'Consulta con análisis de actas o reglamentos',
          'precio', '$36.000,00',
          'nota',   'Incluye la revisión de la documentación que adjuntes.'
        )
      ),
      'nota_total', 'Aboná el valor que corresponda a tu consulta.',
      'cuenta', jsonb_build_object(
        'titular',   'Mercado Pago',
        'cvu',       '0000003100053534352305',
        'alias',     'GestionGlobal.ar',
        'cuit_cuil', '27225982746'
      ),
      'nota_extra', 'El monto depende de si tu consulta requiere análisis de actas o reglamentos, lo seleccionás en «Tu consulta».'
    )
  );
BEGIN
  SELECT id, schema INTO v_id, v_schema
    FROM public.formularios WHERE slug = 'consultoria-juridica';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'F5: no existe el formulario consultoria-juridica';
  END IF;

  -- Idempotencia: ¿ya tiene algún bloque costos_info?
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_schema->'sections') sec,
         jsonb_array_elements(sec->'fields') f
    WHERE f->>'type' = 'costos_info'
  ) INTO v_ya;
  IF v_ya THEN
    RAISE NOTICE 'F5: el formulario ya tiene un bloque costos_info, no se modifica';
    RETURN;
  END IF;

  -- Rebuild por secciones: en "Pago", anteponer el bloque a los fields.
  UPDATE public.formularios f
     SET schema = jsonb_set(
           v_schema,
           '{sections}',
           (SELECT jsonb_agg(
              CASE WHEN sec->>'title' = 'Pago'
                THEN jsonb_set(sec, '{fields}',
                       jsonb_build_array(v_block) || COALESCE(sec->'fields', '[]'::jsonb))
                ELSE sec END
              ORDER BY idx)
            FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY s(sec, idx))
         ),
         schema_draft    = NULL,
         schema_draft_at = NULL,
         updated_at      = now()
   WHERE f.id = v_id;
END
$f5$;

-- Smoke (R18): el form quedó con exactamente 1 bloque costos_info con 2 ítems,
-- y la sección "Pago" sigue conservando el campo del comprobante.
DO $verify$
DECLARE
  v_blocks int;
  v_items  int;
  v_compro int;
BEGIN
  SELECT count(*) FILTER (WHERE f->>'type' = 'costos_info'),
         COALESCE(max(jsonb_array_length(f->'costos'->'items'))
                  FILTER (WHERE f->>'type' = 'costos_info'), 0),
         count(*) FILTER (WHERE f->>'name' = 'comprobante_pago')
    INTO v_blocks, v_items, v_compro
  FROM public.formularios fo,
       jsonb_array_elements(fo.schema->'sections') sec,
       jsonb_array_elements(sec->'fields') f
  WHERE fo.slug = 'consultoria-juridica';

  IF v_blocks <> 1 OR v_items <> 2 OR v_compro <> 1 THEN
    RAISE EXCEPTION 'F5 smoke: blocks=% items=% comprobante=% (esperado 1 / 2 / 1)',
      v_blocks, v_items, v_compro;
  END IF;
  RAISE NOTICE 'F5 smoke OK · 1 bloque costos_info ($20k/$36k) + comprobante intacto';
END
$verify$;
