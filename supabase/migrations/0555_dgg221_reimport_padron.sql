-- 0555_dgg221_reimport_padron.sql
-- =============================================================================
-- DGG-221 · Re-import automático del padrón PBA (cada 10 días). La planilla crece;
-- esta RPC recibe las filas del CSV (desde la edge), descarta clientes y ya-importados,
-- inserta los NUEVOS matriculados (prospecto nuevo o hijo de uno existente por casilla
-- compartida) y los encola al goteo TRAMIX → se suman solos a las campañas.
-- Service-role only (la invoca la edge `prospectos-reimport-padron`). Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prospectos_reimport_aplicar(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_total int; v_clientes int; v_nuevos_prosp int; v_nuevos_padron int; v_encolados int;
BEGIN
  CREATE TEMP TABLE _stage ON COMMIT DROP AS
  SELECT
    NULLIF(btrim(r->>'matricula'),'') AS matricula,
    NULLIF(regexp_replace(COALESCE(r->>'legajo',''),'\D','','g'),'') AS legajo,
    initcap(btrim(regexp_replace(COALESCE(r->>'nombre',''),'\s+',' ','g'))) AS nombre,
    NULLIF(regexp_replace(COALESCE(r->>'cuit',''),'\D','','g'),'') AS cuit,
    CASE WHEN lower(btrim(COALESCE(r->>'mail',''))) IN ('','no figura','nofigura','s/d','-')
         THEN NULL ELSE lower(btrim(r->>'mail')) END AS email,
    (upper(btrim(COALESCE(r->>'sanciones',''))) IN ('SI','SÍ','S')) AS sanciones
  FROM jsonb_array_elements(p_rows) r;

  -- sólo filas usables (con legajo y nombre)
  DELETE FROM _stage WHERE legajo IS NULL OR nombre = '';
  SELECT count(*) INTO v_total FROM _stage;

  -- descartar CLIENTES (cuit o email en administraciones)
  DELETE FROM _stage s WHERE
    (s.cuit IS NOT NULL AND EXISTS (SELECT 1 FROM public.administraciones a WHERE regexp_replace(COALESCE(a.cuit,''),'\D','','g') = s.cuit))
    OR (s.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administraciones a WHERE lower(btrim(COALESCE(a.email,''))) = s.email));
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  -- descartar ya-importados (legajo ya presente en prospecto_padron)
  DELETE FROM _stage s WHERE EXISTS (SELECT 1 FROM public.prospecto_padron pp WHERE pp.legajo = s.legajo);

  -- email sintético para los sin email (quedan como prospecto, sin campañas)
  UPDATE _stage SET email = legajo || '@padron.invalid' WHERE email IS NULL;

  -- crear prospectos nuevos (emails que no existen aún)
  INSERT INTO public.prospectos (nombre, email, cuit, matricula, legajo, sanciones, origen)
  SELECT DISTINCT ON (s.email) s.nombre, s.email, s.cuit, s.matricula, s.legajo, s.sanciones, 'padron_pba'
  FROM _stage s
  WHERE NOT EXISTS (SELECT 1 FROM public.prospectos p WHERE p.email = s.email)
  ORDER BY s.email, s.legajo
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS v_nuevos_prosp = ROW_COUNT;

  -- insertar hijos padrón (dedup por (prospecto_id, legajo))
  WITH ins AS (
    INSERT INTO public.prospecto_padron (prospecto_id, matricula, legajo, cuit, nombre, sanciones)
    SELECT p.id, s.matricula, s.legajo, s.cuit, s.nombre, s.sanciones
    FROM _stage s JOIN public.prospectos p ON p.email = s.email
    ON CONFLICT (prospecto_id, legajo) WHERE legajo IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_nuevos_padron FROM ins;

  -- encolar al goteo TRAMIX (padron nuevos, no enriquecidos, no ya-en-cola)
  WITH enc AS (
    INSERT INTO public.prospecto_tramix_queue (padron_id, legajo)
    SELECT pp.id, pp.legajo
    FROM public.prospecto_padron pp
    JOIN _stage s ON s.legajo = pp.legajo
    WHERE pp.tramix_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.prospecto_tramix_queue q WHERE q.padron_id = pp.id)
    RETURNING 1
  ) SELECT count(*) INTO v_encolados FROM enc;

  RETURN jsonb_build_object(
    'filas_usables', v_total,
    'clientes_excluidos', v_clientes,
    'nuevos_prospectos', v_nuevos_prosp,
    'nuevos_padron', v_nuevos_padron,
    'encolados_tramix', v_encolados);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_reimport_aplicar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospectos_reimport_aplicar(jsonb) TO service_role;
