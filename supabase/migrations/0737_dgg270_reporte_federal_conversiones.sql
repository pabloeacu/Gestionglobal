-- 0737 · DGG-270 — El reporte semanal gana un bloque de CONVERSIONES federal (pedido de Pablo:
-- "la capacidad de medir conversiones [federal]. No nos olvidemos de meterla como parte de los
-- reportes"). El builder ya categorizaba 'federal' en envíos/rebotes/visitas por campaña (0719),
-- pero el bloque de conversiones/cola seguía scopeado SÓLO a captación PBA (origen='padron_pba').
-- Agrega un bloque gemelo `federal` scopeado a origen='import_nacional' (mismas métricas:
-- conversiones semana/total, sin_contactar, en_cola, motor_activo=federal_campanas_activo).
-- Único cambio: suma la clave 'federal' al jsonb; el resto es idéntico a 0719.

create or replace function private._reporte_semanal_build(p_dias integer default 7)
returns jsonb language plpgsql security definer
  set search_path to 'public','pg_temp' set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $function$
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
      and coalesce(template_slug, plantilla, '') <> 'reporte-semanal-plataforma'
      and coalesce(template_slug, plantilla, '') not like '%-preview'
      and coalesce(template_slug, plantilla, '') not like 'qa-%'
  ),
  clasif as (
    select slug, rebote,
      case
        when slug like 'lexph-newsletter%' then 'newsletter'
        when slug like 'captacion-%' then 'captacion'
        when slug like 'federal-%' then 'federal'
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
    where c.categoria in ('newsletter','captacion','federal','ofrecimiento','engagement')
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
        'en_cola', (select count(*) from public.email_queue q
                      join public.prospectos p on p.id = q.related_id and q.related_table = 'prospectos'
                      where p.origen = 'padron_pba' and q.enviado_at is null),
        'motor_activo', (select coalesce(prospectos_campanas_activo, false) from public.config_global limit 1)),
    'federal', jsonb_build_object(
        'conversiones_semana', (select count(*) from public.prospectos where origen = 'import_nacional' and convertido_at >= v_desde),
        'conversiones_total', (select count(*) from public.prospectos where origen = 'import_nacional' and convertido_at is not null),
        'sin_contactar', (select count(*) from public.prospectos where origen = 'import_nacional' and convertido_at is null and baja_at is null
                            and (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and email not like '%.invalid') and ultimo_mail_at is null),
        'en_cola', (select count(*) from public.email_queue q
                      join public.prospectos p on p.id = q.related_id and q.related_table = 'prospectos'
                      where p.origen = 'import_nacional' and q.enviado_at is null),
        'motor_activo', (select coalesce(federal_campanas_activo, false) from public.config_global limit 1))
  ) into v_result
  from tot, supr;

  return v_result;
end
$function$;