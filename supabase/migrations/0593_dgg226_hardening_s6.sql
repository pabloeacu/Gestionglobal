-- 0593_dgg226_hardening_s6.sql
-- DGG-226 · HARDENING §6 — fixes de la doble auditoría (3 agentes) del blindaje.
-- Capitaliza 4 hallazgos (2 críticos) antes del merge:
--
--  A1 (CRÍTICO, Agente A, probado e2e): en 0591 la detección de expediente
--     "especial" (BAJA|SUSPEN|CANCEL|INHABIL|REHABIL) se evaluaba DENTRO del
--     subquery filtrado por `fecha ~ DD/MM/YYYY`. interpret() (tramix-backfill)
--     detecta especial SÓLO por `tramite` (sin fecha ni estado). Una baja/
--     suspensión EN TRÁMITE con fecha vacía se colaba → el self-heal tomaba el
--     camino "limpio" y escribía un vencimiento futuro para un matriculado dado
--     de baja/suspendido, borrando el estado vencida. Fix: especial sobre el
--     array COMPLETO.
--  A2 (Agente A, probado e2e): la matriculación usaba max(d) (la más reciente);
--     interpret() usa la MÁS ANTIGUA (mats[0] tras sort ASC) como ancla cuando
--     no hay renovación. Fix: min(d) para matriculación, max(d) para renovación.
--  A4b (Agente A): el forward-only podía adelantar y re-etiquetar a
--     'verificado_tramix' una fecha FUTURA cargada a mano (gerencia) o declarada
--     por el cliente. Fix: eximir del overwrite una fecha futura de origen
--     manual/declarado (se respeta la fuente humana; el pipeline de reverify
--     maneja las discrepancias declaradas).
--  C1 (CRÍTICO, Agente C, verificado en vivo): existe un SEGUNDO canal de aviso
--     de vencimiento al cliente NO gateado — `gg_vencimientos_planificar_alertas`
--     (cron dispatch-vencimientos, offsets {45,30,15}) manda recordatorios
--     'renovacion_rpac' leyendo la fecha SIN re-verificar TRAMIX. Y el self-heal
--     de 0591 lo ALIMENTA (via trg_admin_matricula_venc_sync). Fix: aplicar el
--     MISMO gate de frescura + encolado a ese canal. (Los otros crons de alarmas
--     —agenda, tracking— no tocan renovacion_rpac/matrícula: verificado.)
--  B12 (Agente B, higiene): REVOKE EXECUTE FROM PUBLIC en los 2 helpers private.
--
-- Reglas: R16 (CREATE OR REPLACE, firmas idénticas), R17 (SECDEF).

-- ───────────────────────────────────────────────────────────────────────────
-- A) Self-heal corregido (A1 + A2 + A4b)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tramix_cache_rederiva_venc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mat date; v_reno date; v_especial boolean; v_venc date;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  -- Un solo scan: min(matriculación) / max(renovación) usan la fecha parseada
  -- (NULL si no parsea → min/max la ignoran); `especial` se evalúa sobre TODO
  -- el array (sin filtro de fecha ni estado), idéntico a interpret() (A1+A2).
  WITH exps AS (
    SELECT e->>'tramite' AS tramite,
           e->>'estado'  AS estado,
           CASE WHEN (e->>'fecha') ~ '^\d{2}/\d{2}/\d{4}$'
                THEN to_date(e->>'fecha','DD/MM/YYYY') END AS d
    FROM jsonb_array_elements(COALESCE(NEW.payload->'expedientes','[]'::jsonb)) e
  )
  SELECT
    min(d) FILTER (WHERE tramite ~* 'ADMINISTRADOR DE CONSORCIOS' AND estado ~* 'INSCRIPTO'),
    max(d) FILTER (WHERE tramite ~* 'RENOVACION DE MATRICULA'    AND estado ~* 'INSCRIPTO'),
    bool_or(tramite ~* 'BAJA|SUSPEN|CANCEL|INHABIL|REHABIL')
  INTO v_mat, v_reno, v_especial
  FROM exps;

  IF v_mat IS NULL OR COALESCE(v_especial, false) THEN
    RETURN NEW;
  END IF;

  v_venc := (COALESCE(v_reno, v_mat) + interval '1 year')::date;
  IF v_venc IS NULL THEN RETURN NEW; END IF;

  PERFORM set_config('app.venc_declarado', 'on', true);

  -- FORWARD-ONLY + eximir fecha FUTURA de origen manual/declarado (A4b).
  UPDATE public.administraciones a
     SET matricula_rpac_vencimiento = v_venc,
         matricula_rpac_vencimiento_origen = 'verificado_tramix',
         matricula_rpac_vencimiento_certeza = 'confirmado',
         matricula_rpac_vencimiento_verificado_at = now(),
         updated_at = now()
   WHERE regexp_replace(COALESCE(a.legajo_rpac,''), '[^0-9]', '', 'g')
       = regexp_replace(COALESCE(NEW.legajo,''),    '[^0-9]', '', 'g')
     AND regexp_replace(COALESCE(a.legajo_rpac,''), '[^0-9]', '', 'g') <> ''
     AND (a.matricula_rpac_vencimiento IS NULL
          OR a.matricula_rpac_vencimiento < v_venc)
     AND NOT (a.matricula_rpac_vencimiento_origen IN ('gerencia','declarado_cliente')
              AND a.matricula_rpac_vencimiento IS NOT NULL
              AND a.matricula_rpac_vencimiento >= v_hoy);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tramix_cache_rederiva_venc fallo legajo=%: %', NEW.legajo, SQLERRM;
  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- B) Gate del SEGUNDO canal (C1): recordatorios de vencimiento al cliente
--    (dispatch-vencimientos). Difiere + encola los renovacion_rpac sin TRAMIX
--    fresco. ÚNICO cambio vs la versión previa: el loop de encolado + la
--    exclusión `NOT (... AND NOT gg_venc_tramix_fresco(...))`. Resto verbatim.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gg_vencimientos_planificar_alertas(p_fecha date DEFAULT hoy_ar())
 RETURNS TABLE(vencimiento_id uuid, offset_dias integer, fecha_vencimiento date, administracion_id uuid, consorcio_id uuid, notificar_cliente boolean, tipo text, descripcion text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE r record;
BEGIN
  -- DGG-226: re-verificar TRAMIX antes del aviso. Encolar (y así diferir) los
  -- renovacion_rpac al cliente que hoy alertarían pero no tienen scrape fresco.
  FOR r IN
    SELECT DISTINCT v.administracion_id AS admin_id
    FROM public.vencimientos v
    CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
    WHERE v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND v.estado IN ('vigente','vencido') AND v.pausado_at IS NULL
      AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
      AND NOT EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id)
  LOOP
    PERFORM private.gg_venc_encolar_refresh(r.admin_id);
  END LOOP;

  RETURN QUERY
  SELECT v.id, o::int AS offset_dias, v.fecha_vencimiento, v.administracion_id,
    v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.administracion_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente')))
    -- DGG-226: diferir el recordatorio de renovacion_rpac al cliente sin TRAMIX fresco.
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id));
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C) Higiene (B12): quitar EXECUTE a PUBLIC de los helpers private.
-- ───────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION private.gg_venc_tramix_fresco(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.gg_venc_encolar_refresh(uuid) FROM PUBLIC;
