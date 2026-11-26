-- 0742 · DGG-274 / E-GG-306 (residuo) — Clasificar el carril de email por SLUG, no por prioridad.
--
-- El fix de E-GG-306 (health-check carril-aware) definió "transaccional" = prioridad <= 5.
-- Pero el dispatcher NO rutea por prioridad: rutea por SLUG (dispatch-emails.marketingUtmFor:
-- prefijos lexph-newsletter / captacion- / federal- / ofrecimiento- / engagement- → SES cuando
-- bulk_via_ses=ON). Un mail de marketing encolado en prioridad <=5 (p.ej. dispatch-vencimientos
-- encola `ofrecimiento-rpac-renovacion` en prioridad 2/5) va a SES por su slug pero el health lo
-- contaba como transaccional → podía gritar "1 transaccional en cola, Gmail mudo (cron caído?)"
-- por una fila de marketing esperando el goteo/cupo. Verificado: 13+ filas `ofrecimiento-%` en
-- prioridad 5; una esperó ~190 min hoy y la corrida de health cayó dentro de esa ventana
-- (zafó de CRITICAL por 2 min de un envío Gmail previo, sin guard).
--
-- Fix: una RPC que clasifica la cola DUE por el MISMO criterio que el dispatcher (slug), en SQL,
-- y devuelve el split {transaccional, marketing}. El edge health-flows-check la llama en vez de
-- filtrar por prioridad. Una sola fuente de verdad del carril = el slug.
--
-- NULL slug → se cuenta como TRANSACCIONAL (coalesce(...,false)): conservador, se vigila.
-- R12: staff/service only (SECURITY DEFINER + guard). STABLE, sólo lectura.

CREATE OR REPLACE FUNCTION public.email_cola_carriles()
RETURNS TABLE(tx_backlog integer, tx_oldest_due timestamptz, mkt_backlog integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH due AS (
    SELECT template_slug, programado_para
    FROM public.email_queue
    WHERE programado_para <= now()
      AND enviado_at IS NULL
      AND intento < max_intentos
  ),
  clasif AS (
    SELECT
      programado_para,
      COALESCE(
        template_slug LIKE 'lexph-newsletter%'
        OR template_slug LIKE 'captacion-%'
        OR template_slug LIKE 'federal-%'
        OR template_slug LIKE 'ofrecimiento-%'
        OR template_slug LIKE 'engagement-%',
        false
      ) AS es_mkt
    FROM due
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT es_mkt)::int                      AS tx_backlog,
    MIN(programado_para) FILTER (WHERE NOT es_mkt)               AS tx_oldest_due,
    COUNT(*) FILTER (WHERE es_mkt)::int                          AS mkt_backlog
  FROM clasif;
$function$;

-- Guard de staff/service: envolvemos en una RPC pública que valida el rol (R12). La fn de arriba
-- es SECURITY DEFINER; el guard vive acá para no duplicar el CTE.
REVOKE EXECUTE ON FUNCTION public.email_cola_carriles() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_cola_carriles() TO service_role;

COMMENT ON FUNCTION public.email_cola_carriles() IS
  'DGG-274/E-GG-306: split de la cola de emails DUE por CARRIL vía slug (la misma fuente que rutea '
  'el dispatcher: prefijos lexph-newsletter/captacion-/federal-/ofrecimiento-/engagement- = marketing SES). '
  'Devuelve {tx_backlog, tx_oldest_due, mkt_backlog}. Lo usa health-flows-check para no contar marketing-SES '
  'de baja prioridad como transaccional. service_role only.';
