-- 0710 · DGG-266 — Cerebro del reporte semanal integral.
-- Pablo: "un reporte semanal de TODOS los correos enviados automáticamente con sus
-- datos de interés: cantidad por LexPH, avisos automáticos a clientes, campañas por
-- tipo y engagement (clicks/visitas), para evaluar marketing + automatización integral."
--
-- Dos funciones:
--   · private._reporte_semanal_build(p_dias) — SIN guard, SECURITY DEFINER, service_role.
--     Es el ÚNICO lugar con la lógica/el query (lo usan el panel y el envío por cron).
--   · public.reporte_semanal_data(p_dias) — wrapper staff-gated para el panel de gerencia.
--
-- Engagement = CLICKS→VISITAS por campaña (UTM, vercel_metricas). NO aperturas: mandamos
-- por Gmail API sin píxel (a propósito, por entregabilidad); no se trackean opens.
-- Categorías por slug: newsletter / captacion / ofrecimiento / engagement / avisos_clientes
-- / transaccional. Rebote = bounced_at o estado bounced/complained o webhook_status='bounced'.

create schema if not exists private;

drop function if exists private._reporte_semanal_build(int);
create function private._reporte_semanal_build(p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $fn$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(p_dias, 1));
  v_ventana text := case when p_dias <= 1 then 'hoy' when p_dias <= 7 then '7d' else '30d' end;
  v_result jsonb;
begin
  with base as (
    select coalesce(template_slug, plantilla, '(sin-slug)') as slug,
           (bounced_at is not null or estado in ('bounced','complained') or webhook_status = 'bounced') as rebote
    from public.sent_emails
    where enviado_at >= v_desde
  ),
  clasif as (
    select slug, rebote,
      case
        when slug like 'lexph-newsletter%' then 'newsletter'
        when slug like 'captacion-%' then 'captacion'
        when slug like 'ofrecimiento-%' then 'ofrecimiento'
        when slug like 'engagement-%' then 'engagement'
        when slug like 'vencimiento%' or slug like 'tracking-%' or slug like 'campus-%'
          or slug like 'nuevo-servicio%' or slug like 'gestoria-%' or slug like 'aviso-%'
          then 'avisos_clientes'
        else 'transaccional'
      end as categoria
    from base
  ),
  por_cat as (
    select categoria, count(*) env, count(*) filter (where rebote) reb
    from clasif group by categoria
  ),
  por_camp as (
    select c.slug, max(c.categoria) categoria, count(*) env, count(*) filter (where c.rebote) reb,
           coalesce(m.visitantes, 0) as visitas
    from clasif c
    left join public.vercel_metricas m
      on m.dimension = 'campaign' and m.ventana = v_ventana and m.valor = c.slug
    where c.categoria in ('newsletter','captacion','ofrecimiento','engagement')
    group by c.slug, m.visitantes
  ),
  por_aviso as (
    select slug, count(*) env, count(*) filter (where rebote) reb
    from clasif where categoria = 'avisos_clientes' group by slug
  ),
  por_trans as (
    select slug, count(*) env, count(*) filter (where rebote) reb
    from clasif where categoria = 'transaccional' group by slug
  ),
  tot as (select count(*) env, count(*) filter (where rebote) reb from clasif),
  supr as (select count(*) n from public.email_suppression where created_at >= v_desde),
  traf as (
    select visitantes, vistas, desde_newsletter, desde_email, medicion_estado
    from public.vercel_trafico where ventana = v_ventana and superficie = 'lexph'
  ),
  refs as (
    select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'visitantes', visitantes)
             order by visitantes desc), '[]'::jsonb) j
    from (select valor, visitantes from public.vercel_metricas
          where dimension = 'referrer' and ventana = v_ventana and valor <> '(directo)'
          order by visitantes desc limit 8) r
  ),
  devs as (
    select coalesce(jsonb_object_agg(valor, visitantes), '{}'::jsonb) j
    from public.vercel_metricas where dimension = 'device' and ventana = v_ventana
  ),
  paises as (
    select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'visitantes', visitantes)
             order by visitantes desc), '[]'::jsonb) j
    from (select valor, visitantes from public.vercel_metricas
          where dimension = 'country' and ventana = v_ventana
          order by visitantes desc limit 6) p
  ),
  capt as (
    select
      (select count(*) from public.prospectos
         where origen = 'padron_pba' and convertido_at >= v_desde) as conversiones,
      (select count(*) from public.prospectos
         where origen = 'padron_pba' and convertido_at is not null) as conversiones_total,
      (select count(*) from public.prospectos
         where origen = 'padron_pba' and convertido_at is null and baja_at is null
           and email not like '%@padron.invalid' and ultimo_mail_at is null) as sin_contactar,
      (select count(*) from public.email_queue
         where related_table = 'prospectos' and enviado_at is null) as en_cola,
      (select coalesce(prospectos_campanas_activo, false) from public.config_global limit 1) as motor_activo
  )
  select jsonb_build_object(
    'generado_at', now(),
    'dias', greatest(p_dias, 1),
    'ventana', v_ventana,
    'totales', jsonb_build_object(
      'enviados', tot.env, 'rebotes', tot.reb,
      'rebote_pct', case when tot.env > 0 then round(tot.reb::numeric / tot.env * 100, 2) else 0 end,
      'supresiones_nuevas', supr.n),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object(
        'categoria', categoria, 'enviados', env, 'rebotes', reb,
        'rebote_pct', case when env > 0 then round(reb::numeric / env * 100, 2) else 0 end)
        order by env desc), '[]'::jsonb) from por_cat),
    'campanas', (select coalesce(jsonb_agg(jsonb_build_object(
        'campana', slug, 'categoria', categoria, 'enviados', env, 'rebotes', reb,
        'rebote_pct', case when env > 0 then round(reb::numeric / env * 100, 2) else 0 end,
        'visitas', visitas) order by env desc), '[]'::jsonb) from por_camp),
    'avisos_clientes', (select coalesce(jsonb_agg(jsonb_build_object(
        'template', slug, 'enviados', env, 'rebotes', reb) order by env desc), '[]'::jsonb) from por_aviso),
    'transaccional', (select coalesce(jsonb_agg(jsonb_build_object(
        'template', slug, 'enviados', env, 'rebotes', reb) order by env desc), '[]'::jsonb) from por_trans),
    'trafico', (select case when traf.visitantes is null then null else jsonb_build_object(
        'visitantes', traf.visitantes, 'vistas', traf.vistas,
        'desde_newsletter', traf.desde_newsletter, 'desde_email', traf.desde_email,
        'medicion_estado', traf.medicion_estado) end from traf),
    'referrers', (select j from refs),
    'dispositivos', (select j from devs),
    'paises', (select j from paises),
    'captacion', (select jsonb_build_object(
        'conversiones_semana', conversiones, 'conversiones_total', conversiones_total,
        'sin_contactar', sin_contactar, 'en_cola', en_cola, 'motor_activo', motor_activo) from capt)
  ) into v_result
  from tot, supr;

  return v_result;
end
$fn$;

revoke all on function private._reporte_semanal_build(int) from public, anon, authenticated;
grant execute on function private._reporte_semanal_build(int) to service_role;

-- Wrapper staff-gated para el panel de gerencia.
drop function if exists public.reporte_semanal_data(int);
create function public.reporte_semanal_data(p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_staff() then
    raise exception 'solo staff' using errcode = '42501';
  end if;
  return private._reporte_semanal_build(p_dias);
end
$fn$;

revoke all on function public.reporte_semanal_data(int) from public, anon;
grant execute on function public.reporte_semanal_data(int) to authenticated;
