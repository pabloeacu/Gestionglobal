-- 0712 · DGG-266 — Hardening §6 del reporte (menores de la auditoría de 3 agentes).
--  A1  coherencia: el tile "Visitas desde emails" usa la figura autoritativa desde_email
--      (nivel proyecto) en vez de la suma parcial por-campaña (dos números distintos en
--      el mismo mail). (§6-e coherencia aviso↔display)
--  A2  categorización: 'recordatorio-%' y 'recupero-%' (avisos a clientes) ya no caen en
--      'transaccional'. (§6-a fan-out de slugs)
--  A4/B2 excluir del reporte los envíos de prueba/preview y el PROPIO mail de reporte
--      (self-reference que inflaba 'transaccional' cada semana).
--  B1  render robusto POR DISEÑO: layout_version='legacy' (hoy renderiza sólo por el
--      fallback defensivo E-GG-74; si alguien lo toca, el mail salía "sólo logo").
--  B3  drop de la función huérfana prospectos_reporte_semanal() (sin cron ni caller).

-- B1 — fijar el layout del template del reporte.
update public.email_templates
  set layout_version = 'legacy', updated_at = now()
  where slug = 'reporte-semanal-plataforma';

-- A2 + A4/B2 — builder con categorización corregida y exclusiones.
create or replace function private._reporte_semanal_build(p_dias int default 7)
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
      and coalesce(template_slug, plantilla, '') <> 'reporte-semanal-plataforma'  -- self-reference
      and coalesce(template_slug, plantilla, '') not like '%-preview'              -- previews
      and coalesce(template_slug, plantilla, '') not like 'qa-%'                   -- tests QA
  ),
  clasif as (
    select slug, rebote,
      case
        when slug like 'lexph-newsletter%' then 'newsletter'
        when slug like 'captacion-%' then 'captacion'
        when slug like 'ofrecimiento-%' then 'ofrecimiento'
        when slug like 'engagement-%' then 'engagement'
        when slug like 'vencimiento%' or slug like 'recordatorio-%' or slug like 'recupero-%'
          or slug like 'tracking-%' or slug like 'campus-%'
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
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'visitantes', visitantes)
        order by visitantes desc), '[]'::jsonb)
        from (select valor, visitantes from public.vercel_metricas
              where dimension = 'referrer' and ventana = v_ventana and valor <> '(directo)'
              order by visitantes desc limit 8) r),
    'dispositivos', (select coalesce(jsonb_object_agg(valor, visitantes), '{}'::jsonb)
        from public.vercel_metricas where dimension = 'device' and ventana = v_ventana),
    'paises', (select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'visitantes', visitantes)
        order by visitantes desc), '[]'::jsonb)
        from (select valor, visitantes from public.vercel_metricas
              where dimension = 'country' and ventana = v_ventana
              order by visitantes desc limit 6) p),
    'captacion', jsonb_build_object(
        'conversiones_semana', (select count(*) from public.prospectos where origen = 'padron_pba' and convertido_at >= v_desde),
        'conversiones_total', (select count(*) from public.prospectos where origen = 'padron_pba' and convertido_at is not null),
        'sin_contactar', (select count(*) from public.prospectos where origen = 'padron_pba' and convertido_at is null and baja_at is null and email not like '%@padron.invalid' and ultimo_mail_at is null),
        'en_cola', (select count(*) from public.email_queue where related_table = 'prospectos' and enviado_at is null),
        'motor_activo', (select coalesce(prospectos_campanas_activo, false) from public.config_global limit 1))
  ) into v_result
  from tot, supr;

  return v_result;
end
$fn$;

-- A1 — el tile del email usa desde_email (autoritativo), no la suma parcial por campaña.
create or replace function public.reporte_semanal_enviar(p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $fn$
declare
  v_data jsonb;
  v_catmap jsonb;
  v_top_camp text; v_top_vis int;
  v_vars jsonb;
  v_cuerpo text;
  v_enviados int;
  v_visitas_email text;
begin
  v_data := private._reporte_semanal_build(p_dias);

  select jsonb_object_agg(e->>'categoria', e) into v_catmap
  from jsonb_array_elements(v_data->'categorias') e;
  v_catmap := coalesce(v_catmap, '{}'::jsonb);

  select e->>'campana', coalesce((e->>'visitas')::int, 0) into v_top_camp, v_top_vis
  from jsonb_array_elements(v_data->'campanas') e
  order by coalesce((e->>'visitas')::int,0) desc, coalesce((e->>'enviados')::int,0) desc
  limit 1;

  v_enviados := coalesce((v_data->'totales'->>'enviados')::int, 0);
  -- Figura autoritativa (utm_medium=email, nivel proyecto); 'n/d' si no es medible.
  v_visitas_email := coalesce(v_data->'trafico'->>'desde_email', 'n/d');

  v_vars := jsonb_build_object(
    'periodo', (v_data->>'dias') || ' días',
    'generado', to_char(now(), 'DD/MM/YYYY HH24:MI'),
    'total_enviados', v_enviados,
    'rebote_pct', coalesce(v_data->'totales'->>'rebote_pct', '0'),
    'supresiones', coalesce(v_data->'totales'->>'supresiones_nuevas', '0'),
    'visitas_email', v_visitas_email,
    'nl_env', coalesce((v_catmap->'newsletter'->>'enviados')::int, 0),
    'nl_reb', coalesce(v_catmap->'newsletter'->>'rebote_pct', '0'),
    'capt_env', coalesce((v_catmap->'captacion'->>'enviados')::int, 0),
    'capt_reb', coalesce(v_catmap->'captacion'->>'rebote_pct', '0'),
    'ofr_env', coalesce((v_catmap->'ofrecimiento'->>'enviados')::int, 0),
    'ofr_reb', coalesce(v_catmap->'ofrecimiento'->>'rebote_pct', '0'),
    'eng_env', coalesce((v_catmap->'engagement'->>'enviados')::int, 0),
    'eng_reb', coalesce(v_catmap->'engagement'->>'rebote_pct', '0'),
    'avisos_env', coalesce((v_catmap->'avisos_clientes'->>'enviados')::int, 0),
    'avisos_reb', coalesce(v_catmap->'avisos_clientes'->>'rebote_pct', '0'),
    'trans_env', coalesce((v_catmap->'transaccional'->>'enviados')::int, 0),
    'trans_reb', coalesce(v_catmap->'transaccional'->>'rebote_pct', '0'),
    'top_camp', coalesce(v_top_camp, '—'),
    'top_camp_vis', coalesce(v_top_vis, 0),
    'visitantes', coalesce(v_data->'trafico'->>'visitantes', 'n/d'),
    'desde_newsletter', coalesce(v_data->'trafico'->>'desde_newsletter', 'n/d'),
    'desde_email', coalesce(v_data->'trafico'->>'desde_email', 'n/d'),
    'conv_captacion', coalesce(v_data->'captacion'->>'conversiones_semana', '0'),
    'conv_total', coalesce(v_data->'captacion'->>'conversiones_total', '0'),
    'en_cola', coalesce(v_data->'captacion'->>'en_cola', '0'),
    'motor_estado', case when (v_data->'captacion'->>'motor_activo')::boolean then 'activo' else 'apagado' end,
    'url', '/gerencia/analitica/marketing'
  );

  v_cuerpo := format(
    'Semana: %s correos (%s%% rebote) · %s visitas desde emails · %s conversiones de captación. Ver el detalle completo en el panel.',
    v_enviados, coalesce(v_data->'totales'->>'rebote_pct','0'),
    v_visitas_email, coalesce(v_data->'captacion'->>'conversiones_semana','0'));

  perform public.notify_all_gerentes(
    'reporte_semanal_plataforma',
    'Reporte semanal · Automatización & Marketing',
    v_cuerpo,
    '/gerencia/analitica/marketing',
    '{}'::jsonb,
    true,
    'reporte-semanal-plataforma',
    v_vars,
    5::smallint
  );

  return jsonb_build_object('ok', true, 'enviados', v_enviados, 'vars', v_vars);
end
$fn$;

revoke all on function public.reporte_semanal_enviar(int) from public, anon, authenticated;
grant execute on function public.reporte_semanal_enviar(int) to service_role;

-- B3 — drop de la función huérfana (sin cron ni caller tras el repunte de 0711).
drop function if exists public.prospectos_reporte_semanal();
