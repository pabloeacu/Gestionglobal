-- 0715 · DGG-267 — Hardening §6 (auditoría 3 agentes). Sin críticos de datos; 1 crítico de
-- display (grilla Prospectos inundada) + menores de seguridad/robustez.

-- (C-crítico) La página gerencia "Prospectos" (leads de eventos/formularios) mostraba TODO lo
-- no-padron → ahora se inundaba con los 10.250 import_nacional. Excluir ambos orígenes de marketing.
create or replace function public.prospectos_listado(p_webinar_id uuid default null::uuid)
returns table(id uuid, nombre text, email text, telefono text, origen text, observaciones text, convertido_a_administracion_id uuid, convertido_at timestamptz, created_at timestamptz, updated_at timestamptz, eventos_total integer, eventos_asistidos integer, ultimo_evento_at timestamptz, convertido boolean, cliente_activo boolean, cliente_estado text)
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
  select p.id, p.nombre, p.email, p.telefono, p.origen, p.observaciones,
    p.convertido_a_administracion_id, p.convertido_at, p.created_at, p.updated_at,
    coalesce(agg.eventos_total,0)::int, coalesce(agg.eventos_asistidos,0)::int, agg.ultimo_evento_at,
    (p.convertido_a_administracion_id is not null), a.activo, a.estado
  from public.prospectos p
  left join public.administraciones a on a.id = p.convertido_a_administracion_id
  left join lateral (
    select count(*)::int eventos_total, count(*) filter (where wi.asistio)::int eventos_asistidos, max(w.fecha_hora) ultimo_evento_at
    from public.webinar_inscriptos wi join public.webinars w on w.id=wi.webinar_id where wi.prospecto_id=p.id
  ) agg on true
  where p.origen not in ('padron_pba','import_nacional')   -- marketing (PBA + nacional) fuera de la grilla de leads
    and (p_webinar_id is null or exists (select 1 from public.webinar_inscriptos wf where wf.prospecto_id=p.id and wf.webinar_id=p_webinar_id))
  order by p.created_at desc;
end $fn$;

-- (A-menor) 1 gerente se coló en prospectos import_nacional (la exclusión cubría sólo clientes).
-- Borrar toda cuenta de plataforma colada (los clientes ya estaban excluidos → sólo borra staff).
delete from public.prospectos
 where origen = 'import_nacional'
   and lower(btrim(email)) in (select lower(btrim(au.email)) from auth.users au where au.email is not null);

-- (A-menor + B-menor) Endurecer mkt_import_aplicar: excluir TODA cuenta de plataforma (no sólo
-- clientes) de captación Y LexPH; validar sintaxis de email y excluir '%.invalid' (lección E-GG-267).
create or replace function public.mkt_import_aplicar()
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_prosp int := 0; v_lexph int := 0; v_univ int := 0;
begin
  select count(*) into v_univ from public.mkt_import_staging;
  -- _cli = TODA cuenta de plataforma (clientes + gerentes/operadores): email del login + email de la admin.
  create temp table _cli on commit drop as
    select distinct lower(btrim(au.email)) e from auth.users au where au.email is not null
    union
    select distinct lower(btrim(a.email)) from public.administraciones a where a.email is not null and btrim(a.email) <> '';
  with nuevos as (
    select s.email, s.nombre, s.jurisdiccion, s.matricula, s.origen_fuente
      from public.mkt_import_staging s
     where s.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and s.email not like '%.invalid'
       and not exists (select 1 from _cli c where c.e = s.email)
       and not exists (select 1 from public.prospectos p where lower(btrim(p.email)) = s.email)
       and not exists (select 1 from public.email_suppression x where lower(btrim(x.email)) = s.email)
  )
  insert into public.prospectos (nombre, email, matricula, origen, jurisdiccion, observaciones, baja_token)
  select coalesce(nullif(btrim(nombre), ''), split_part(email, '@', 1)),
         email, nullif(matricula, ''), 'import_nacional', jurisdiccion,
         nullif(left('Import GG · ' || coalesce(origen_fuente, ''), 300), 'Import GG · '),
         gen_random_uuid()::text
    from nuevos
  on conflict (email) do nothing;
  get diagnostics v_prosp = row_count;
  with nuevos as (
    select s.email from public.mkt_import_staging s
     where s.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and s.email not like '%.invalid'
       and not exists (select 1 from _cli c where c.e = s.email)
       and not exists (select 1 from public.lexph_suscriptores l where l.email_norm = s.email)
       and not exists (select 1 from public.email_suppression x where lower(btrim(x.email)) = s.email)
  )
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select email, email, 'confirmado', 'import_nacional', now() from nuevos
  on conflict (email_norm) do nothing;
  get diagnostics v_lexph = row_count;
  return jsonb_build_object('universo', v_univ, 'nuevos_prospectos', v_prosp, 'nuevos_lexph', v_lexph);
end $fn$;
revoke all on function public.mkt_import_aplicar() from public, anon, authenticated;
grant execute on function public.mkt_import_aplicar() to service_role;

-- (B-menor) lexph_newsletter_enviar_especifico: el dedup sólo veía PENDIENTES; agregar también
-- los YA ENVIADOS de esa edición, para que la herramienta sea segura de re-invocar.
create or replace function public.lexph_newsletter_enviar_especifico(p_edicion_id uuid, p_emails text[])
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_intro text; v_seq int; v_html text; v_slug text; v_count int := 0; c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode='42501'; end if;
  if p_emails is null or array_length(p_emails,1) is null then raise exception 'No pasaste ningún mail.' using errcode='22023'; end if;
  select e.intro, e.seq into v_intro, v_seq from public.lexph_ediciones e where e.id=p_edicion_id;
  if not found then raise exception 'Edición no encontrada.' using errcode='P0002'; end if;
  if coalesce(btrim(v_intro),'')='' then raise exception 'Completá al menos la intro del digest antes de enviar.' using errcode='22023'; end if;
  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then raise exception 'No se pudo generar el HTML.' using errcode='P0002'; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text,'-',''));
  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug, 'LexPH Newsletter · Edición ' || coalesce(v_seq::text,'') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH', v_html, 'general', 'legacy', true)
  on conflict (slug) do update set body_html=excluded.body_html, asunto=excluded.asunto, layout_version='legacy', from_casilla='general', activo=true, updated_at=now();
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select distinct on (lower(btrim(e))) btrim(e), lower(btrim(e)), 'confirmado', 'manual', now()
    from unnest(p_emails) e
   where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and not exists (select 1 from public.email_suppression s where s.email = lower(btrim(e)))
   order by lower(btrim(e))
  on conflict (email_norm) do nothing;
  insert into public.email_queue (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para, max_intentos)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url','https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8, 'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.email) - 1) / c_cap_dia))::int * interval '1 day', 10
    from public.lexph_suscriptores s
   where s.email_norm = any (select distinct lower(btrim(e)) from unnest(p_emails) e where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     and s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where sup.email = s.email_norm)
     and not exists (select 1 from public.email_queue q2 where q2.template_slug=v_slug and q2.enviado_at is null and lower(btrim(q2.to_email))=s.email_norm)
     and not exists (select 1 from public.sent_emails se where se.template_slug=v_slug and lower(btrim(se.to_email))=s.email_norm);  -- (nuevo) no re-enviar a quien ya recibió esta edición
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'enviados', v_count);
end $fn$;
