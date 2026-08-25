-- ============================================================================
-- 0454 · E-GG-194 — Fechas contables en horario Argentina (barrido exhaustivo)
-- ----------------------------------------------------------------------------
-- Aplicada vía MCP el 2026-08-25 (versión DB 20260825161740, registrada con
-- nombre "0453_egg194_..."); este archivo la versiona en el repo (R6).
--
-- BUG (reporte JL): una cobranza registrada el 24/08/2026 21:36 ART quedó
-- fechada 25-ago. Causa raíz: la BD corre en UTC, y 21:36 ART = 00:36 UTC del
-- día siguiente. Tanto los defaults de columna (`now()::date`/`current_date`)
-- como las RPC que computan "hoy" server-side devolvían la fecha UTC → fecha
-- contable corrida un día después de las ~21 hs.
--
-- FIX backend (este archivo):
--   1. Helper `hoy_ar()` → fecha de hoy en horario AR (absoluto, no depende de
--      la sesión). Úsese como default y en cualquier cómputo de fecha de negocio.
--   2. Defaults de columnas de fecha de negocio → `hoy_ar()`.
--   3. `ALTER FUNCTION ... SET TimeZone='America/Argentina/Buenos_Aires'` en las
--      RPC que resuelven `current_date`/`now()::date` para fechas de negocio.
--      Esto hace que `current_date`/`now()::date` DENTRO de la función se
--      resuelvan en ART sin reescribir el cuerpo ni cambiar la serialización de
--      ningún `timestamptz` (que se sigue devolviendo en UTC al cliente).
--
-- FIX frontend (fuera de esta migración): helpers `hoyISO()/hoyISOoffset()/
-- toISODate()` en src/lib/dates.ts (Intl 'en-CA' timeZone AR), aplicados a los
-- ~42 sitios que persistían/mostraban "hoy" con `new Date().toISOString()`.
--
-- NOTA: NO se hizo `ALTER DATABASE SET timezone` (habría cambiado la
-- serialización de TODOS los timestamptz de +00 a -03, con riesgo en los
-- string-slices crudos de timestamptz que aún existen en el front).
-- ============================================================================

-- 1) Helper: hoy en horario Argentina ---------------------------------------
create or replace function public.hoy_ar()
returns date
language sql
stable
set search_path = 'public', 'pg_temp'
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

grant execute on function public.hoy_ar() to authenticated, anon, service_role;

-- 2) Defaults de columnas de fecha de negocio -------------------------------
alter table public.comprobantes      alter column fecha         set default public.hoy_ar();
alter table public.comprobantes      alter column periodo       set default (date_trunc('month', public.hoy_ar()::timestamp)::date);
alter table public.movimientos       alter column fecha         set default public.hoy_ar();
alter table public.tabulador_precios alter column vigente_desde set default public.hoy_ar();

-- 3) RPC que computan "hoy" server-side → resolver current_date/now()::date en
--    horario AR (sin tocar el cuerpo ni la serialización de timestamptz).
alter function public.ajuste_masivo_precios(text, uuid, numeric, text)                              set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cliente_ctacte_extracto(date, date, uuid)                                     set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cliente_deuda_neta(uuid)                                                      set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cliente_portal_dashboard()                                                    set timezone = 'America/Argentina/Buenos_Aires';
alter function public.comprobantes_morosos(uuid)                                                    set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cuenta_corriente_morosos(integer)                                             set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cuenta_corriente_resumen(uuid, date, date)                                    set timezone = 'America/Argentina/Buenos_Aires';
alter function public.cuenta_corriente_resumen_global(date, date)                                   set timezone = 'America/Argentina/Buenos_Aires';
alter function public.curso_matricular(uuid, uuid, uuid)                                            set timezone = 'America/Argentina/Buenos_Aires';
alter function public.curso_registrar_pago(uuid, numeric, uuid, text)                               set timezone = 'America/Argentina/Buenos_Aires';
alter function public.disparar_recupero_manual(uuid, smallint, text)                                set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_dashboard_kpis()                                                           set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_reporte_balance_mensual(integer, boolean)                                  set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_reporte_comparativo(integer)                                               set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_reporte_flujo_caja(integer, uuid)                                          set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_reporte_pyg(date, date)                                                    set timezone = 'America/Argentina/Buenos_Aires';
alter function public.fz_revertir_movimiento(uuid, text)                                            set timezone = 'America/Argentina/Buenos_Aires';
alter function public.gerencia_alarmas_hoy()                                                        set timezone = 'America/Argentina/Buenos_Aires';
alter function public.gg_vencimientos_planificar_alertas(date)                                      set timezone = 'America/Argentina/Buenos_Aires';
alter function public.kpis_dashboard_global(date)                                                   set timezone = 'America/Argentina/Buenos_Aires';
alter function public.marcar_renovado(uuid, date)                                                   set timezone = 'America/Argentina/Buenos_Aires';
alter function public.pago_reportar(uuid, uuid, uuid, numeric, date, text, text, text, text)        set timezone = 'America/Argentina/Buenos_Aires';
alter function public.proximos_vencimientos(uuid, smallint)                                         set timezone = 'America/Argentina/Buenos_Aires';
alter function public.recalcular_saldo_comprobante_imputado()                                       set timezone = 'America/Argentina/Buenos_Aires';
alter function public.resolver_precio_servicio(uuid, uuid, uuid, date)                              set timezone = 'America/Argentina/Buenos_Aires';
alter function public.solicitud_derivar_v3(uuid, text, text, text, text, integer, numeric, jsonb, uuid, uuid, date, text) set timezone = 'America/Argentina/Buenos_Aires';
alter function public.tracking_cerrar(uuid, text, boolean, text, text)                              set timezone = 'America/Argentina/Buenos_Aires';
alter function public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)                         set timezone = 'America/Argentina/Buenos_Aires';
alter function public.venc_auto_clasificar_vencido()                                                set timezone = 'America/Argentina/Buenos_Aires';
