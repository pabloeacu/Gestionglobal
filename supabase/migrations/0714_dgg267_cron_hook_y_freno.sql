-- 0714 · DGG-267 — (req #3) el re-import del padrón PBA también nutre LexPH + salvaguarda
-- de rebotes del newsletter (protege la reputación de TODA la cuenta, incl. comprobantes).

-- (A) prospectos_reimport_aplicar: ahora los matriculados nuevos también se suman a LexPH
--     (confirmado), salvo suprimidos. Igual patrón que el import nacional. Idempotente.
create or replace function public.prospectos_reimport_aplicar(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_total int; v_clientes int; v_nuevos_prosp int; v_nuevos_padron int; v_encolados int; v_nuevos_lexph int;
begin
  create temp table _stage on commit drop as
  select
    nullif(btrim(r->>'matricula'),'') as matricula,
    nullif(regexp_replace(coalesce(r->>'legajo',''),'\D','','g'),'') as legajo,
    initcap(btrim(regexp_replace(coalesce(r->>'nombre',''),'\s+',' ','g'))) as nombre,
    nullif(regexp_replace(coalesce(r->>'cuit',''),'\D','','g'),'') as cuit,
    case when lower(btrim(coalesce(r->>'mail',''))) in ('','no figura','nofigura','s/d','-')
         then null else lower(btrim(r->>'mail')) end as email,
    (upper(btrim(coalesce(r->>'sanciones',''))) in ('SI','SÍ','S')) as sanciones
  from jsonb_array_elements(p_rows) r;

  delete from _stage where legajo is null or nombre = '';
  select count(*) into v_total from _stage;

  delete from _stage s where
    (s.cuit is not null and exists (select 1 from public.administraciones a where regexp_replace(coalesce(a.cuit,''),'\D','','g') = s.cuit))
    or (s.email is not null and exists (select 1 from public.administraciones a where lower(btrim(coalesce(a.email,''))) = s.email))
    or exists (select 1 from public.administraciones a where a.legajo_rpac = s.legajo);
  get diagnostics v_clientes = row_count;

  delete from _stage s where exists (select 1 from public.prospecto_padron pp where pp.legajo = s.legajo);

  -- (nuevo) ANTES de ponerles el email ficticio: los que tienen email REAL se suman a LexPH.
  with nl as (
    insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
    select distinct s.email, s.email, 'confirmado', 'padron_pba', now()
    from _stage s
    where s.email is not null
      and not exists (select 1 from public.lexph_suscriptores l where l.email_norm = s.email)
      and not exists (select 1 from public.email_suppression x where x.email = s.email)
    on conflict (email_norm) do nothing
    returning 1
  ) select count(*) into v_nuevos_lexph from nl;

  update _stage set email = legajo || '@padron.invalid' where email is null;

  insert into public.prospectos (nombre, email, cuit, matricula, legajo, sanciones, origen, jurisdiccion)
  select distinct on (s.email) s.nombre, s.email, s.cuit, s.matricula, s.legajo, s.sanciones, 'padron_pba', 'PBA'
  from _stage s
  where not exists (select 1 from public.prospectos p where p.email = s.email)
  order by s.email, s.legajo
  on conflict (email) do nothing;
  get diagnostics v_nuevos_prosp = row_count;

  with ins as (
    insert into public.prospecto_padron (prospecto_id, matricula, legajo, cuit, nombre, sanciones)
    select p.id, s.matricula, s.legajo, s.cuit, s.nombre, s.sanciones
    from _stage s join public.prospectos p on p.email = s.email
    on conflict (prospecto_id, legajo) where legajo is not null do nothing
    returning 1
  ) select count(*) into v_nuevos_padron from ins;

  with enc as (
    insert into public.prospecto_tramix_queue (padron_id, legajo)
    select pp.id, pp.legajo from public.prospecto_padron pp join _stage s on s.legajo = pp.legajo
    where pp.tramix_at is null and not exists (select 1 from public.prospecto_tramix_queue q where q.padron_id = pp.id)
    returning 1
  ) select count(*) into v_encolados from enc;

  return jsonb_build_object(
    'filas_usables', v_total, 'clientes_excluidos', v_clientes,
    'nuevos_prospectos', v_nuevos_prosp, 'nuevos_padron', v_nuevos_padron,
    'encolados_tramix', v_encolados, 'nuevos_lexph', v_nuevos_lexph);
end $fn$;

-- (B) Salvaguarda: alerta a gerencia si el newsletter rebota feo (reputación compartida con
--     los comprobantes). Monitoreo + aviso; la pausa queda a criterio de gerencia.
create or replace function private.lexph_freno_rebotes_check()
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_sent int; v_bounce int; v_pct numeric; c_umbral constant numeric := 4.0; c_min constant int := 200;
begin
  select count(*), count(*) filter (where estado in ('bounced','complained') or bounced_at is not null or webhook_status='bounced')
    into v_sent, v_bounce
    from public.sent_emails
    where template_slug like 'lexph-newsletter%' and enviado_at >= now() - interval '6 hours';
  v_pct := case when v_sent > 0 then round(v_bounce::numeric / v_sent * 100, 2) else 0 end;
  if v_sent >= c_min and v_pct > c_umbral then
    perform public.notify_all_gerentes(
      'lexph_rebotes_alto', 'Alerta · rebotes del newsletter altos',
      format('El newsletter LexPH rebotó %s%% en las últimas 6h (%s de %s). Si sigue subiendo, pausá el envío: la reputación del remitente afecta también a los comprobantes (cuenta Workspace compartida, E-GG-294).', v_pct, v_bounce, v_sent),
      '/gerencia/analitica/marketing', '{}'::jsonb, true);
  end if;
  return jsonb_build_object('sent_6h', v_sent, 'bounce', v_bounce, 'pct', v_pct, 'alerta', (v_sent >= c_min and v_pct > c_umbral));
end $fn$;
revoke all on function private.lexph_freno_rebotes_check() from public, anon, authenticated;
grant execute on function private.lexph_freno_rebotes_check() to service_role;

select cron.unschedule('lexph-freno-rebotes') where exists (select 1 from cron.job where jobname='lexph-freno-rebotes');
select cron.schedule('lexph-freno-rebotes', '15 * * * *', $cron$ select private.lexph_freno_rebotes_check(); $cron$);
