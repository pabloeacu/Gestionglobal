-- 0585 · DGG-225 · Re-scrapeo TRAMIX encolado para el agente de cierre (FASE 1: PLANNER)
--
-- Contexto (E-GG-230, por documentar): el detector `private.agente_cierre_detectar`
-- verifica el estado RPAC leyendo `public.tramix_cache`, pero esa tabla SOLO la
-- escribe el visor TRAMIX que un humano abre a mano (edge tramix-consulta). Los
-- scrapers de fondo (tramix-backfill/tramix-reverify) bajan los expedientes y los
-- DESCARTAN (sólo guardan el vencimiento en la ficha) → nunca pueblan tramix_cache.
-- Por eso trámites del track principal (matrícula/renovación/certificado RPAC) quedan
-- eternamente en "a revisar · falta scrapear el legajo", aunque el legajo esté `ok`
-- en la cola de backfill.
--
-- Rediseño (3 fases, hands-off vía pg_cron, reusa el patrón DGG-216): en cada corrida
-- diaria el agente (1) ENCOLA el re-scrape de los legajos de sus candidatos de cierre
-- del track principal (este archivo), (2) un worker pautado los scrapea 1 cada 5 min y
-- ESCRIBE tramix_cache fresco (edge tramix-cierre-scrape), y (3) recién después corre
-- el cierre sobre cache fresca del día. Garantiza "verificar con dato fresco en cada
-- intento" (requisito de Pablo) y cuida la IP (ritmo ~0,2 req/min, más lento que el
-- sancionado ~1/min; un solo consumidor efectivo; breaker compartido intacto).
--
-- Un scrape por LEGAJO sirve a TODOS los trámites de ese legajo (la cache es PK=legajo
-- y el detector joina por legajo) → el caso multi-trámite por legajo queda cubierto por
-- construcción (la desambiguación del cierre va en el detector, mig 0586).

-- ───────────────────────── cola de refresco ─────────────────────────
CREATE TABLE IF NOT EXISTS public.tramix_cierre_refresh_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legajo        text NOT NULL,                              -- normalizado a dígitos (clave de tramix_cache)
  admin_id      uuid REFERENCES public.administraciones(id) ON DELETE CASCADE,
  estado        text NOT NULL DEFAULT 'pendiente',          -- pendiente|procesando|ok|flag|error
  intentos      int  NOT NULL DEFAULT 0,
  n_expedientes int,
  flag          text,
  resultado     text,                                       -- OK|NOT_FOUND|TIMEOUT|TRAMIX_DOWN|PARCIAL|...
  titular       text,
  run_date      date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tramix_cierre_refresh_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tramix_cierre_refresh_queue TO authenticated;                       -- monitoreo gerencia
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tramix_cierre_refresh_queue TO service_role; -- el edge + planner
-- Defensa en profundidad (§6 A#4): los default privileges (pre-30/10/2026) otorgan
-- CRUD a anon/authenticated; RLS ya lo contiene (sólo policy SELECT), pero revocamos
-- explícito para no depender 100% de RLS. authenticated queda sólo con SELECT.
REVOKE ALL ON public.tramix_cierre_refresh_queue FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tramix_cierre_refresh_queue FROM authenticated;
CREATE POLICY cierre_refresh_staff_select ON public.tramix_cierre_refresh_queue
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_refresh_legajo ON public.tramix_cierre_refresh_queue(legajo);
CREATE INDEX IF NOT EXISTS idx_cierre_refresh_estado ON public.tramix_cierre_refresh_queue(estado, updated_at);

-- ───────────────────────── claim atómico (clon de tramix_backfill_claim) ─────────────────────────
CREATE OR REPLACE FUNCTION public.tramix_cierre_refresh_claim()
 RETURNS TABLE(id uuid, admin_id uuid, legajo text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.tramix_cierre_refresh_queue q
     SET estado = 'procesando', updated_at = now()
   WHERE q.id = (
     SELECT q2.id FROM public.tramix_cierre_refresh_queue q2
      WHERE q2.estado = 'pendiente'
         -- umbral de re-claim > intervalo del cron (5 min, §6 B#5b): deja margen para
         -- un scrape largo en curso y evita un doble-scrape concurrente del mismo legajo.
         OR (q2.estado = 'procesando' AND q2.updated_at < now() - interval '15 minutes')
      ORDER BY q2.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.admin_id, q.legajo;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.tramix_cierre_refresh_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tramix_cierre_refresh_claim() TO service_role;

-- ───────────────────────── planner: encola los legajos del día ─────────────────────────
-- Corre read-only agente_cierre_detectar(), toma los legajos DISTINCT (dedup) de los
-- candidatos track='principal' que NO están hard-blocked (impago/arancelado/sin_otorg),
-- limpia la cola de la corrida anterior y los encola. NO cierra nada.
-- Encola TODOS los candidatos principales no bloqueados (incluidos los que hoy pasarían
-- con cache vieja) para garantizar FRESCURA POR INTENTO: nadie cierra sin re-scrape del día.
CREATE OR REPLACE FUNCTION public.agente_cierre_planificar()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.tramix_cierre_refresh_queue;  -- cola efímera por día

  INSERT INTO public.tramix_cierre_refresh_queue (legajo, admin_id, run_date)
  SELECT DISTINCT ON (regexp_replace(e->>'legajo', '[^0-9]', '', 'g'))
         regexp_replace(e->>'legajo', '[^0-9]', '', 'g') AS legajo,
         (e->>'administracion_id')::uuid,
         (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  FROM jsonb_array_elements(private.agente_cierre_detectar()) e
  WHERE e->>'track' = 'principal'
    AND e->>'decision' <> 'reportar_bloqueo'
    AND COALESCE(regexp_replace(e->>'legajo', '[^0-9]', '', 'g'), '') <> ''
  ON CONFLICT (legajo) DO UPDATE
     SET estado = 'pendiente', intentos = 0, run_date = EXCLUDED.run_date, updated_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'encolados', v_n);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.agente_cierre_planificar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agente_cierre_planificar() TO authenticated, service_role;
