-- 0562_dgg222_f1_agente_cierre.sql
-- =============================================================================
-- DGG-222 · Equipo de cierre de trámites — FASE 1 (detección + reporte EN SECO).
-- 100% ADITIVO: no toca `tracking_cerrar` ni ninguna lógica existente.
-- GATED: `config_global.agente_cierre_activo` default FALSE (sólo lo usa el modo
-- 'real' de fases futuras; esta fase corre siempre en 'seco' = no cierra nada,
-- no escribe a ningún cliente).
--
-- Entrega F1:
--   · flag de activación (gate para F2+).
--   · tabla run-log `agente_cierre_runs` (auditable). Least-privilege: sólo
--     SELECT para authenticated (RLS → staff); escritura sólo vía SECDEF.
--   · helper `private.tramix_fecha(text)` — parseo DD/MM/YYYY tolerante (NULL si
--     la fecha es inválida/malformada; no explota ante cache TRAMIX defectuoso).
--   · `private.agente_cierre_detectar()` — dataset read-only de candidatos del
--     TRACK PRINCIPAL (resuelto +25d por created_at, excluye curso y jurídica):
--     amortiguadores replicados de `tramite_cerrar_exige_cobrado` (impago /
--     arancelado-sin-comprobante / matrícula-reno sin otorgamiento — más
--     estricto, nunca más laxo) + verificación TRAMIX desde cache POR SERVICIO
--     (inscripción/renovación = INSCRIPTO, certificado = NOTIFICADO OFICIOS),
--     tomando el expediente más reciente del tipo. Robusto ante payload
--     malformado (guard de array + fecha tolerante). NO cierra. En schema
--     private (no expuesta por PostgREST).
--   · `public.agente_cierre_correr(p_origen)` — corre la detección, registra un
--     run (modo 'seco'), y encola el "Resumen de agentes (SIMULACIÓN)" a
--     pabloeacu@gmail.com (salvo cron sin candidatos → no manda ruido). Guard:
--     staff O cron/service, NO anon. EXECUTE revocado a anon/PUBLIC. SECDEF +
--     search_path (R5). Sin overloads (R16).
-- §6 (3 agentes + e2e): 0 falsos positivos, aditividad confirmada, GAP de acceso
-- anónimo cerrado (REVOKE), fragilidad ante cache malformado cerrada (helper +
-- guard). Deuda F2 anotada: anclar el match TRAMIX al expediente/ventana del
-- trámite + exigir frescura de cache (consultado_at >= created_at) antes de
-- auto-cerrar; manejar cierre_satisfactorio=false (rechazo/abandono).
-- =============================================================================

-- 1) GATE ---------------------------------------------------------------------
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS agente_cierre_activo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.config_global.agente_cierre_activo IS
  'DGG-222: gate del equipo de cierre de trámites. FALSE = sólo simulación/seco. Lo prende Pablo tras validar.';

-- 2) RUN-LOG ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agente_cierre_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at      timestamptz NOT NULL DEFAULT now(),
  origen      text NOT NULL DEFAULT 'manual',   -- cron | manual
  modo        text NOT NULL DEFAULT 'seco',     -- seco | real
  overall     text,                             -- ok | sin_candidatos | error
  resumen     jsonb NOT NULL DEFAULT '{}'::jsonb,
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid DEFAULT auth.uid()
);
ALTER TABLE public.agente_cierre_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agente_cierre_runs FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.agente_cierre_runs TO authenticated;  -- escritura sólo vía SECDEF
CREATE POLICY agente_cierre_runs_staff_select ON public.agente_cierre_runs
  FOR SELECT USING (private.is_staff());
CREATE INDEX IF NOT EXISTS idx_agente_cierre_runs_run_at ON public.agente_cierre_runs (run_at DESC);

-- 3) HELPER fecha tolerante ---------------------------------------------------
CREATE OR REPLACE FUNCTION private.tramix_fecha(p text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN to_date(p, 'DD/MM/YYYY');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- 4) DETECCIÓN (read-only, privada) -------------------------------------------
CREATE OR REPLACE FUNCTION private.agente_cierre_detectar()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH cand AS (
  SELECT t.id AS tramite_id, t.categoria, t.servicio_id, sv.codigo AS servicio_codigo,
         t.administracion_id, t.comprobante_id,
         t.created_at, (now()::date - t.created_at::date) AS dias_abierto,
         sv.nombre AS servicio, a.nombre AS cliente,
         a.legajo_rpac AS legajo, a.matricula_rpac AS matricula,
         a.matricula_rpac_vencimiento AS venc_ficha,
         public.cobro_pendiente(t) AS impago,
         (EXISTS (SELECT 1 FROM public.servicios s2 WHERE s2.id=t.servicio_id
                    AND GREATEST(COALESCE(s2.precio_publico,0),COALESCE(s2.precio_cliente,0),COALESCE(s2.precio_base,0))>0)
          AND NOT EXISTS (SELECT 1 FROM public.comprobantes c WHERE c.estado<>'anulado' AND COALESCE(c.total,0)>0
                    AND (c.id=t.comprobante_id
                         OR c.id IN (SELECT so.comprobante_id FROM public.solicitudes so
                                      WHERE so.tramite_id=t.id AND so.comprobante_id IS NOT NULL)))
         ) AS arancelado_sin_comp,
         (t.categoria IN ('matricula','renovacion')
          AND NOT (NULLIF(btrim(a.matricula_rpac),'') IS NOT NULL
                   AND NULLIF(btrim(a.legajo_rpac),'') IS NOT NULL)) AS sin_otorg,
         CASE sv.codigo
           WHEN 'rpac_inscripcion'          THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_inscripcion_juridica' THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_renovacion'           THEN 'RENOVACION DE MATRICULA'
           WHEN 'rpac_certificado'          THEN 'CERTIFICADO DE ACREDITACION'
           ELSE NULL END AS exp_esperado,
         CASE sv.codigo
           WHEN 'rpac_certificado'          THEN 'NOTIFICADO OFICIOS'
           WHEN 'rpac_inscripcion'          THEN 'INSCRIPTO'
           WHEN 'rpac_inscripcion_juridica' THEN 'INSCRIPTO'
           WHEN 'rpac_renovacion'           THEN 'INSCRIPTO'
           ELSE NULL END AS estado_ok
  FROM public.tramites t
  JOIN public.administraciones a ON a.id = t.administracion_id
  LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
  WHERE t.estado = 'resuelto'
    AND (now() - t.created_at) > interval '25 days'
    AND t.categoria NOT IN ('curso','consulta_juridica')
),
tx AS (
  SELECT c.tramite_id,
    (tc.legajo IS NOT NULL) AS tiene_cache,
    (SELECT jsonb_build_object('estado', e->>'estado', 'tramite', e->>'tramite', 'fecha', e->>'fecha', 'numero', e->>'numero')
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(tc.payload->'expedientes')='array'
                   THEN tc.payload->'expedientes' ELSE '[]'::jsonb END) e
      WHERE c.exp_esperado IS NOT NULL AND e->>'tramite' = c.exp_esperado
      ORDER BY private.tramix_fecha(e->>'fecha') DESC NULLS LAST,
               (e->>'numero') DESC NULLS LAST
      LIMIT 1) AS ult
  FROM cand c
  LEFT JOIN public.tramix_cache tc ON tc.legajo = c.legajo
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'tramite_id', c.tramite_id, 'categoria', c.categoria, 'servicio', c.servicio,
  'servicio_codigo', c.servicio_codigo, 'cliente', c.cliente,
  'administracion_id', c.administracion_id, 'legajo', c.legajo,
  'matricula', c.matricula, 'venc_ficha', c.venc_ficha, 'dias_abierto', c.dias_abierto,
  'bloqueos', (
      (CASE WHEN c.impago             THEN jsonb_build_array('impago') ELSE '[]'::jsonb END)
   || (CASE WHEN c.arancelado_sin_comp THEN jsonb_build_array('arancelado_sin_comprobante') ELSE '[]'::jsonb END)
   || (CASE WHEN c.sin_otorg          THEN jsonb_build_array('sin_otorgamiento') ELSE '[]'::jsonb END)
  ),
  'tramix', CASE WHEN c.exp_esperado IS NULL THEN jsonb_build_object('estado','servicio_no_mapeado')
                 WHEN NOT x.tiene_cache      THEN jsonb_build_object('estado','sin_cache')
                 WHEN x.ult IS NULL          THEN jsonb_build_object('estado','sin_expediente')
                 ELSE x.ult END,
  'decision', CASE
     WHEN c.impago OR c.arancelado_sin_comp OR c.sin_otorg THEN 'reportar_bloqueo'
     WHEN c.exp_esperado IS NOT NULL AND x.tiene_cache AND x.ult->>'estado' = c.estado_ok THEN 'cerrar_limpio'
     ELSE 'reportar_revision' END,
  'motivo', CASE
     WHEN c.impago                THEN 'Cobro pendiente (impago/parcial)'
     WHEN c.arancelado_sin_comp   THEN 'Servicio arancelado sin comprobante emitido'
     WHEN c.sin_otorg             THEN 'Falta matrícula+legajo RPAC en la ficha (cargar otorgamiento)'
     WHEN c.exp_esperado IS NULL  THEN 'Servicio sin regla TRAMIX definida — revisar manual'
     WHEN NOT x.tiene_cache       THEN 'Sin verificación TRAMIX (falta scrapear el legajo)'
     WHEN x.ult IS NULL           THEN 'TRAMIX sin expediente de '||c.exp_esperado
     WHEN x.ult->>'estado' = c.estado_ok THEN 'TRAMIX confirma '||c.exp_esperado||' = '||c.estado_ok||' → cerrable'
     WHEN x.ult->>'estado' = 'OBSERVADO' THEN 'TRAMIX: '||c.exp_esperado||' OBSERVADO — revisar'
     ELSE 'TRAMIX: '||c.exp_esperado||' en estado "'||(x.ult->>'estado')||'" (no terminal) — revisar'
     END
) ORDER BY
     (CASE WHEN c.impago OR c.arancelado_sin_comp OR c.sin_otorg THEN 2
           WHEN c.exp_esperado IS NOT NULL AND x.tiene_cache AND x.ult->>'estado' = c.estado_ok THEN 0 ELSE 1 END),
     c.cliente
), '[]'::jsonb)
FROM cand c JOIN tx x ON x.tramite_id = c.tramite_id;
$$;
REVOKE EXECUTE ON FUNCTION private.agente_cierre_detectar() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION private.agente_cierre_detectar() TO service_role;

-- 5) RUNNER (registra run + reporte en seco) ----------------------------------
CREATE OR REPLACE FUNCTION public.agente_cierre_correr(p_origen text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $$
DECLARE
  v_items jsonb;
  v_total int; v_limpios int; v_bloqueos int; v_revision int;
  v_resumen jsonb; v_run_id uuid;
  v_hoy text := to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'DD/MM/YYYY');
  v_lista text; v_cuerpo text;
BEGIN
  -- Guard: staff, service_role o cron (postgres). Rechaza anon y authenticated no-staff.
  IF NOT (private.is_staff()
          OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_items := private.agente_cierre_detectar();
  v_total := jsonb_array_length(v_items);
  SELECT count(*) FILTER (WHERE it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'decision'='reportar_revision')
    INTO v_limpios, v_bloqueos, v_revision
    FROM jsonb_array_elements(v_items) it;

  v_resumen := jsonb_build_object('total', v_total, 'cerrar_limpio', v_limpios,
                 'reportar_revision', v_revision, 'reportar_bloqueo', v_bloqueos, 'modo', 'seco');

  INSERT INTO public.agente_cierre_runs (origen, modo, overall, resumen, items)
  VALUES (p_origen, 'seco', CASE WHEN v_total=0 THEN 'sin_candidatos' ELSE 'ok' END, v_resumen, v_items)
  RETURNING id INTO v_run_id;

  -- Reporte: siempre en manual; en cron sólo si hay candidatos (no spamear runs vacíos).
  IF v_total > 0 OR p_origen <> 'cron' THEN
    SELECT string_agg(
             format('• %s — %s (%s) · %s d · %s',
                    it->>'cliente', initcap(it->>'categoria'),
                    COALESCE(it->>'servicio','—'), it->>'dias_abierto', it->>'motivo'),
             E'\n' ORDER BY it->>'decision', it->>'cliente')
      INTO v_lista FROM jsonb_array_elements(v_items) it;

    v_cuerpo :=
      'SIMULACIÓN — equipo de cierre de trámites · ' || v_hoy || E'\n' ||
      '(Fase 1: detecto y te reporto. NO cerré nada ni le escribí a ningún cliente.)' || E'\n\n' ||
      'Track principal (resueltos +25 días, excluye cursos y jurídica): ' || v_total || ' trámites.' || E'\n' ||
      '  Cerraria (limpios + TRAMIX confirma): ' || v_limpios || E'\n' ||
      '  A revisar (falta verificar TRAMIX / observado): ' || v_revision || E'\n' ||
      '  Bloqueados (amortiguador, no se fuerzan): ' || v_bloqueos || E'\n\n' ||
      COALESCE(v_lista, '(sin candidatos)') || E'\n\n' ||
      'Cuando valides, habilito el cierre automatico de los limpios (con reprogramacion de vencimientos). ' ||
      'Los bloqueados y los "a revisar" siempre quedan para vos.';

    INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables,
                                    prioridad, intento, max_intentos, programado_para)
    VALUES ('workflow', 'gerencia-notif-generica', 'pabloeacu@gmail.com', 'Pablo',
            jsonb_build_object('titulo_evento', 'Resumen de agentes · Cierre de trámites (SIMULACIÓN)',
              'url', '/gerencia/tramites', 'cuerpo', v_cuerpo),
            3, 0, 3, now());
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'resumen', v_resumen);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.agente_cierre_correr(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_cierre_correr(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.agente_cierre_correr(text) IS
  'DGG-222 F1: corre el equipo de cierre en modo SECO (detecta + registra run + reporte a Pablo). No cierra nada. Gate real en config_global.agente_cierre_activo (fases futuras).';
