-- ============================================================================
-- 0455 · E-GG-194 ANEXO — barrer los now()/current_date crudos que quedaron
-- (hallazgos §6 Agente B). Todos MENOR (ninguno corrompe fecha contable en
-- régimen normal; divergen sólo en la ventana ~21:00–23:59 AR con arg omitido,
-- o 31-dic noche para los códigos de año). Se fixean por consistencia contable
-- (feedback_consistencia_contable) y para no dejar deuda documentada.
--
-- Técnica: `pg_get_functiondef` + `replace` + re-`EXECUTE`. Parte del cuerpo
-- ACTUAL (preserva SECURITY DEFINER, search_path y el SET TimeZone=AR de mig
-- 0454), cambia SÓLO el token indicado, y verifica que el token existía (si no,
-- RAISE). Cambiar el DEFAULT de un parámetro NO altera la firma → no crea
-- overload (R16 OK).
--
-- Patrón de fix:
--   · defaults de parámetro `DEFAULT CURRENT_DATE`  → `DEFAULT public.hoy_ar()`
--     (el SET TimeZone NO cubre el default del parámetro: se evalúa en la tz de
--     la sesión (UTC) ANTES de entrar al cuerpo; hoy_ar() es tz-independiente).
--   · `date_trunc('month', now())` → `date_trunc('month', now(), 'AR')`
--     (3-arg date_trunc de PG16+: trunca en AR y PRESERVA el tipo timestamptz).
--   · `(now() - p_dias*interval)::date` → `(public.hoy_ar() - p_dias)`.
--   · `to_char(now(),'YYYY')` (año de código) → `to_char(public.hoy_ar(),'YYYY')`.
-- ============================================================================

-- Helper local: aplica un replace verificado sobre la def actual de una función.
create or replace function pg_temp._egg194_swap(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $fn$
declare d text; n text;
begin
  d := pg_get_functiondef(p_fn);
  n := replace(d, p_old, p_new);
  if n = d then
    raise exception 'E-GG-194 anexo: token % no encontrado en %', p_old, p_fn;
  end if;
  execute n;
end $fn$;

-- B#1 · defaults de parámetro DEFAULT CURRENT_DATE → DEFAULT public.hoy_ar()
select pg_temp._egg194_swap('public.gg_vencimientos_planificar_alertas(date)'::regprocedure,
  'p_fecha date DEFAULT CURRENT_DATE', 'p_fecha date DEFAULT public.hoy_ar()');
select pg_temp._egg194_swap('public.resolver_precio_servicio(uuid,uuid,uuid,date)'::regprocedure,
  'p_fecha date DEFAULT CURRENT_DATE', 'p_fecha date DEFAULT public.hoy_ar()');
-- cuenta_corriente_resumen / _global: dos defaults (p_desde y p_hasta). El body
-- usa `current_date` en minúscula (cubierto por el SET TimeZone) → intacto.
select pg_temp._egg194_swap('public.cuenta_corriente_resumen(uuid,date,date)'::regprocedure,
  'CURRENT_DATE - ''1 year''::interval', 'public.hoy_ar() - ''1 year''::interval');
select pg_temp._egg194_swap('public.cuenta_corriente_resumen(uuid,date,date)'::regprocedure,
  'p_hasta date DEFAULT CURRENT_DATE', 'p_hasta date DEFAULT public.hoy_ar()');
select pg_temp._egg194_swap('public.cuenta_corriente_resumen_global(date,date)'::regprocedure,
  'CURRENT_DATE - ''1 year''::interval', 'public.hoy_ar() - ''1 year''::interval');
select pg_temp._egg194_swap('public.cuenta_corriente_resumen_global(date,date)'::regprocedure,
  'p_hasta date DEFAULT CURRENT_DATE', 'p_hasta date DEFAULT public.hoy_ar()');

-- B#2 · analitica mensual: bucket de mes en AR (3-arg date_trunc preserva timestamptz)
select pg_temp._egg194_swap('public.analitica_cobranzas_mensual(integer)'::regprocedure,
  'date_trunc(''month'', now())', 'date_trunc(''month'', now(), ''America/Argentina/Buenos_Aires'')');
select pg_temp._egg194_swap('public.analitica_facturacion_mensual(integer)'::regprocedure,
  'date_trunc(''month'', now())', 'date_trunc(''month'', now(), ''America/Argentina/Buenos_Aires'')');

-- B#3 · analitica ventana: borde inferior en AR
select pg_temp._egg194_swap('public.analitica_mix_servicios(integer)'::regprocedure,
  '(now() - p_dias * INTERVAL ''1 day'')::date', '(public.hoy_ar() - p_dias)');
select pg_temp._egg194_swap('public.analitica_top_clientes(integer,integer)'::regprocedure,
  '(now() - p_dias * INTERVAL ''1 day'')::date', '(public.hoy_ar() - p_dias)');

-- B#4 · año del código de certificado en AR (el resto de now() = emitido_at real, intacto)
select pg_temp._egg194_swap('public.emitir_certificado(uuid)'::regprocedure,
  'to_char(now(), ''YYYY'')', 'to_char(public.hoy_ar(), ''YYYY'')');
select pg_temp._egg194_swap('public.emitir_certificado_webinar(uuid,uuid)'::regprocedure,
  'to_char(now(), ''YYYY'')', 'to_char(public.hoy_ar(), ''YYYY'')');
select pg_temp._egg194_swap('public.emitir_certificados_evento(uuid)'::regprocedure,
  'to_char(now(), ''YYYY'')', 'to_char(public.hoy_ar(), ''YYYY'')');

-- B#5 · año del código de trámite TRM-YYYY en AR (secuencia global → sin cambio de numeración)
select pg_temp._egg194_swap('public.tramites_set_codigo()'::regprocedure,
  'to_char(now(), ''YYYY'')', 'to_char(public.hoy_ar(), ''YYYY'')');
