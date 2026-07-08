-- 0291 · Capitalización de prospectos (Fase 5) — pedido Pablo.
--
-- Los eventos (ex-"webinars", mig 0286) generan prospectos (leads no-clientes).
-- Un prospecto puede anotarse a MUCHOS eventos (una fila en webinar_inscriptos
-- por anotación). Esta migración expone, para la pantalla de gerencia de
-- Prospectos, el ENGAGEMENT del lead (cuántos eventos, a cuántos asistió, cuándo
-- fue el último) para poder priorizar el seguimiento comercial.
--
-- TODO ADITIVO → no toca prospectos / webinar_inscriptos / la conversión a
-- cliente (convertir_prospecto_a_cliente) ni la edición (actualizarProspecto).
-- Sólo agrega 3 RPCs de LECTURA.
--
-- Reglas aplicadas:
--   R5  · SECURITY DEFINER + SET search_path = public, pg_temp.
--   R11 · toda FK con índice (webinar_inscriptos.prospecto_id / .webinar_id).
--   R12 · single-tenant: staff-only, no hay p_administracion_id → guard is_staff().
--   Higiene de permisos (E-GG-88 / mig 0279): REVOKE ALL … FROM PUBLIC +
--         REVOKE EXECUTE … FROM anon (¡obligatorio!) + GRANT a authenticated,
--         service_role. OJO: este proyecto tiene un `ALTER DEFAULT PRIVILEGES`
--         (pg_default_acl de `postgres` en `public`) que auto-otorga EXECUTE a
--         `anon` en TODA función nueva (default Supabase pre-0130). Ese grant es
--         DIRECTO (anon=X en proacl), así que `REVOKE … FROM PUBLIC` NO lo saca
--         — hay que revocar explícito a anon o el rol público queda con execute
--         (aunque el guard is_staff() igual lo rebota con 42501 en runtime).
--
-- Notas de diseño:
--   • `ultimo_evento_at` = MAX(webinars.fecha_hora) entre las anotaciones del
--     prospecto. Se usa la fecha DEL EVENTO (no inscripto_at) porque es el dato
--     comercialmente relevante ("último evento al que vino/se anotó").
--   • `convertido` = convertido_a_administracion_id IS NOT NULL (misma fuente de
--     verdad que la grilla actual, que mira convertido_at).
--   • p_webinar_id en prospectos_listado: si NO es null → sólo prospectos con al
--     menos una anotación en ESE evento (EXISTS), pero los contadores
--     eventos_total/eventos_asistidos siguen contando TODOS sus eventos (universo
--     completo del prospecto — un lead que vino a 3 eventos es caliente aunque lo
--     filtres por uno). R19: el KPI no se recorta por el filtro.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) R11 · asegurar índices de FK en webinar_inscriptos.
--    Ambos ya existen (idx_webinar_inscriptos_prospecto parcial +
--    idx_webinar_inscriptos_webinar compuesto (webinar_id, canal) que lidera
--    por webinar_id). Los CREATE … IF NOT EXISTS son no-ops idempotentes que
--    dejan asentado el requisito por si en un entorno fresco faltaran.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_prospecto
  ON public.webinar_inscriptos(prospecto_id) WHERE prospecto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_webinar
  ON public.webinar_inscriptos(webinar_id, canal);

-- ---------------------------------------------------------------------------
-- 1) prospectos_listado(p_webinar_id) — grilla de gerencia con engagement.
--    Incluye cliente_activo/cliente_estado (E-GG-46) para NO perder el badge
--    "Cliente de baja" que ya mostraba la grilla legacy (Regla 15: control
--    presente en legacy y ausente en la nueva = regresión silenciosa).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospectos_listado(uuid);

CREATE FUNCTION public.prospectos_listado(p_webinar_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  nombre text,
  email text,
  telefono text,
  origen text,
  observaciones text,
  convertido_a_administracion_id uuid,
  convertido_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  eventos_total integer,
  eventos_asistidos integer,
  ultimo_evento_at timestamptz,
  convertido boolean,
  cliente_activo boolean,
  cliente_estado text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre,
    p.email,
    p.telefono,
    p.origen,
    p.observaciones,
    p.convertido_a_administracion_id,
    p.convertido_at,
    p.created_at,
    p.updated_at,
    COALESCE(agg.eventos_total, 0)::int      AS eventos_total,
    COALESCE(agg.eventos_asistidos, 0)::int  AS eventos_asistidos,
    agg.ultimo_evento_at,
    (p.convertido_a_administracion_id IS NOT NULL) AS convertido,
    a.activo  AS cliente_activo,
    a.estado  AS cliente_estado
  FROM public.prospectos p
  LEFT JOIN public.administraciones a ON a.id = p.convertido_a_administracion_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int                                   AS eventos_total,
      COUNT(*) FILTER (WHERE wi.asistio)::int         AS eventos_asistidos,
      MAX(w.fecha_hora)                               AS ultimo_evento_at
    FROM public.webinar_inscriptos wi
    JOIN public.webinars w ON w.id = wi.webinar_id
    WHERE wi.prospecto_id = p.id
  ) agg ON TRUE
  WHERE
    p_webinar_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.webinar_inscriptos wf
      WHERE wf.prospecto_id = p.id AND wf.webinar_id = p_webinar_id
    )
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.prospectos_listado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_listado(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.prospectos_listado(uuid) IS
  'Fase 5: grilla de gerencia de prospectos + engagement (eventos_total/asistidos/último). Staff-only. p_webinar_id filtra por evento pero los contadores cuentan TODOS los eventos del prospecto (R19).';

-- ---------------------------------------------------------------------------
-- 2) prospecto_eventos(p_prospecto_id) — historial de eventos del prospecto.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospecto_eventos(uuid);

CREATE FUNCTION public.prospecto_eventos(p_prospecto_id uuid)
RETURNS TABLE (
  webinar_id uuid,
  titulo text,
  fecha_hora timestamptz,
  canal text,
  asistio boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    w.id       AS webinar_id,
    w.titulo,
    w.fecha_hora,
    wi.canal,
    wi.asistio
  FROM public.webinar_inscriptos wi
  JOIN public.webinars w ON w.id = wi.webinar_id
  WHERE wi.prospecto_id = p_prospecto_id
  ORDER BY w.fecha_hora DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.prospecto_eventos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospecto_eventos(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.prospecto_eventos(uuid) IS
  'Fase 5: historial de eventos de un prospecto (título + fecha + canal + asistió), fecha desc. Staff-only.';

-- ---------------------------------------------------------------------------
-- 3) webinar_captacion_resumen(p_webinar_id) — mini-panel de captación por
--    evento. Devuelve jsonb con el embudo inscriptos → asistieron → convertidos.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.webinar_captacion_resumen(uuid);

CREATE FUNCTION public.webinar_captacion_resumen(p_webinar_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inscriptos     integer;
  v_asistieron     integer;
  v_prospectos     integer;
  v_clientes       integer;
  v_convertidos    integer;
  v_tasa           numeric;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE wi.asistio)::int,
    COUNT(*) FILTER (WHERE wi.prospecto_id IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE wi.administracion_id IS NOT NULL)::int
  INTO v_inscriptos, v_asistieron, v_prospectos, v_clientes
  FROM public.webinar_inscriptos wi
  WHERE wi.webinar_id = p_webinar_id;

  -- convertidos = prospectos de ESTE evento que ya tienen
  -- convertido_a_administracion_id (se pasaron a cliente).
  SELECT COUNT(DISTINCT p.id)::int
  INTO v_convertidos
  FROM public.webinar_inscriptos wi
  JOIN public.prospectos p ON p.id = wi.prospecto_id
  WHERE wi.webinar_id = p_webinar_id
    AND p.convertido_a_administracion_id IS NOT NULL;

  v_tasa := CASE WHEN v_inscriptos > 0
    THEN round((v_asistieron::numeric / v_inscriptos::numeric) * 100, 1)
    ELSE 0 END;

  RETURN jsonb_build_object(
    'inscriptos', v_inscriptos,
    'asistieron', v_asistieron,
    'prospectos', v_prospectos,
    'clientes', v_clientes,
    'convertidos', v_convertidos,
    'tasa_asistencia', v_tasa
  );
END;
$$;

REVOKE ALL ON FUNCTION public.webinar_captacion_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webinar_captacion_resumen(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.webinar_captacion_resumen(uuid) IS
  'Fase 5: embudo de captación de un evento (inscriptos/asistieron/prospectos/clientes/convertidos/tasa_asistencia). Staff-only.';

-- ---------------------------------------------------------------------------
-- 4) Smoke (R16 · sin overloads): cada RPC nueva tiene 1 sola firma.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n int;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['prospectos_listado','prospecto_eventos','webinar_captacion_resumen']
  LOOP
    SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'smoke 0291: se esperaba 1 firma de %, hay %', v_fn, v_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'smoke 0291 OK: prospectos_listado / prospecto_eventos / webinar_captacion_resumen (1 firma c/u)';
END $$;

COMMIT;
