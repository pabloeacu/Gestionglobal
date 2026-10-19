-- 0591_dgg226_selfheal_venc_de_cache.sql
-- DGG-226 · BLINDAJE (2/3) — AUTO-CORRECCIÓN DE LA FICHA ("...actualizá su ficha").
--
-- Trigger sobre tramix_cache: cada vez que un scrapeo FRESCO escribe los
-- expedientes de un legajo (lo hacen el visor on-demand `tramix-consulta`, el
-- worker de cierre `tramix-cierre-scrape`, y los scrapeos de verificación de
-- vencimiento de esta misma feature), re-deriva el vencimiento de matrícula con
-- las MISMAS reglas que interpret() del backfill (DGG-216) y actualiza la ficha
-- FORWARD-ONLY: sólo adelanta el vencimiento, nunca lo pisa hacia atrás. Así,
-- si TRAMIX muestra una renovación que la ficha no tenía, la ficha se corrige
-- sola — y jamás se degrada una fecha futura cargada a mano (gerencia) o
-- declarada por el cliente (declarado_cliente), porque el forward-only la respeta.
--
-- Interacciones verificadas (§6):
--   • admin_venc_certeza_default (BEFORE UPDATE OF venc) pisaría origen→'gerencia'
--     si no se marca app.venc_declarado='on'. Lo seteamos → nuestro
--     origen='verificado_tramix'/certeza='confirmado' queda firme (patrón 0535).
--   • reverify_enqueue SÓLO dispara con certeza='declarado' → NO lo tocamos
--     (seteamos 'confirmado') → sin re-encolado, sin loop, sin scrapeo extra.
--   • trg_admin_matricula_venc_sync mantiene la tabla `vencimientos` sincronizada
--     con el nuevo venc (deseado; va envuelto en su propio EXCEPTION).
--   • Todo el cuerpo va en BEGIN/EXCEPTION → un fallo JAMÁS rompe el upsert de
--     cache (no abortamos el pipeline de cierre ni el visor).
--
-- Forward-only = monótono → aunque un reverify-tick re-scrapeara, converge y no
-- hay loop. tramix_cache tiene RLS sin policy de write ⇒ SECDEF (R17).
-- Reglas: R16 (trigger nuevo, no overload), R17 (SECDEF).

CREATE OR REPLACE FUNCTION public.tramix_cache_rederiva_venc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mat date; v_reno date; v_especial boolean; v_venc date;
BEGIN
  -- Re-derivación (reglas interpret(): matriculación / última renovación /
  -- expedientes "especiales" que invalidan la lectura automática).
  SELECT
    max(d) FILTER (WHERE tramite ~* 'ADMINISTRADOR DE CONSORCIOS' AND estado ~* 'INSCRIPTO'),
    max(d) FILTER (WHERE tramite ~* 'RENOVACION DE MATRICULA'    AND estado ~* 'INSCRIPTO'),
    bool_or(tramite ~* 'BAJA|SUSPEN|CANCEL|INHABIL|REHABIL')
  INTO v_mat, v_reno, v_especial
  FROM (
    SELECT e->>'tramite' AS tramite,
           e->>'estado'  AS estado,
           to_date(e->>'fecha','DD/MM/YYYY') AS d
    FROM jsonb_array_elements(COALESCE(NEW.payload->'expedientes','[]'::jsonb)) e
    WHERE (e->>'fecha') ~ '^\d{2}/\d{2}/\d{4}$'
  ) x;

  -- "limpio" (interpret.flag IS NULL) ⟺ hay matriculación y no hay especial.
  -- Caso sucio (sin matriculación / baja / suspensión / etc.) → NO se auto-escribe.
  IF v_mat IS NULL OR COALESCE(v_especial, false) THEN
    RETURN NEW;
  END IF;

  -- vencimiento = (última renovación, o matriculación) + 12 meses.
  v_venc := (COALESCE(v_reno, v_mat) + interval '1 year')::date;
  IF v_venc IS NULL THEN RETURN NEW; END IF;

  -- Camino oficial/sistema: que admin_venc_certeza_default NO resetee a 'gerencia'.
  PERFORM set_config('app.venc_declarado', 'on', true);

  -- FORWARD-ONLY: sólo adelanta el vencimiento. Match por legajo normalizado.
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
          OR a.matricula_rpac_vencimiento < v_venc);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tramix_cache_rederiva_venc fallo legajo=%: %', NEW.legajo, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tramix_cache_rederiva_venc ON public.tramix_cache;
CREATE TRIGGER trg_tramix_cache_rederiva_venc
  AFTER INSERT OR UPDATE OF payload ON public.tramix_cache
  FOR EACH ROW EXECUTE FUNCTION public.tramix_cache_rederiva_venc();
