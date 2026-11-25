-- 0722 · DGG-268 — Guard durable: el newsletter LexPH NO sale a la lista fría
-- import_nacional por el canal Gmail/Workspace compartido.
--
-- Capitaliza el incidente de rebotes del 25/11 (E-GG-298): un blast del newsletter a
-- ~10k direcciones frías import_nacional por la cuenta Gmail compartida con los
-- comprobantes generó hard-bounces que ponen en riesgo la reputación del dominio
-- (E-GG-294, "cuenta Workspace compartida"). El freno puntual limpió la cola; este
-- guard lo hace DURABLE: la audiencia import_nacional queda excluida del enqueue del
-- newsletter MIENTRAS el marketing vaya por Gmail, y se re-habilita SOLA cuando
-- config_global.bulk_via_ses = true (DGG-268: marketing por SES = reputación aislada).
--
-- R16: ambas funciones se re-crean con su MISMA firma (sin overload).
-- Sólo se agrega una condición a la audiencia; el resto del cuerpo es idéntico al vigente.

create or replace function public.lexph_newsletter_enviar(p_edicion_id uuid, p_programado_desde timestamp with time zone default now())
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_intro   text;
  v_seq     int;
  v_already timestamptz;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
  v_desde   timestamptz := greatest(p_programado_desde, now());
  c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;

  select e.intro, e.seq, e.newsletter_enviado_at
    into v_intro, v_seq, v_already
    from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then
    raise exception 'Edición no encontrada (id=%).', p_edicion_id using errcode = 'P0002';
  end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar el newsletter.' using errcode = '22023';
  end if;

  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  if exists (
    select 1 from public.email_queue
     where template_slug = v_slug and enviado_at is null and status = 'pending'
  ) then
    raise exception 'La edición N°% ya tiene un envío en curso (quedan correos pendientes en la cola). Esperá a que termine antes de reenviar.', coalesce(v_seq::text, '?')
      using errcode = '55000';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then
    raise exception 'No se pudo generar el HTML del newsletter.' using errcode = 'P0002';
  end if;

  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug,
          'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH',
          v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html, asunto = excluded.asunto,
        layout_version = 'legacy', from_casilla = 'general', activo = true, updated_at = now();

  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para, max_intentos)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8,
         'lexph_suscriptores', s.id,
         v_desde + (floor((row_number() over (order by s.created_at, s.id) - 1) / c_cap_dia))::int * interval '1 day',
         10
    from public.lexph_suscriptores s
   where s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where lower(btrim(sup.email)) = s.email_norm)
     -- DGG-268 (guard durable, E-GG-298): la lista fría import_nacional NO sale por el canal
     -- Gmail/Workspace compartido. Se re-habilita SOLA cuando el marketing va por SES.
     and (s.origen <> 'import_nacional'
          or coalesce((select cg.bulk_via_ses from public.config_global cg where cg.id = 1), false));
  get diagnostics v_count = row_count;

  update public.lexph_ediciones
     set newsletter_enviado_at = now(), newsletter_reporte_at = null
   where id = p_edicion_id;

  begin
    perform public.lexph_edicion_avisar_portal(p_edicion_id, true);
  exception when others then
    raise warning 'lexph_edicion_avisar_portal falló para edición %: %', p_edicion_id, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true, 'enviados', v_count,
    'dias', ceil(v_count::numeric / c_cap_dia),
    'desde', v_desde,
    'reenvio', v_already is not null
  );
end
$function$;

create or replace function public.lexph_newsletter_enviar_especifico(p_edicion_id uuid, p_emails text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
     and not exists (select 1 from public.sent_emails se where se.template_slug=v_slug and lower(btrim(se.to_email))=s.email_norm)
     -- DGG-268 (guard durable, E-GG-298): idem masivo — import_nacional no sale por Gmail.
     and (s.origen <> 'import_nacional'
          or coalesce((select cg.bulk_via_ses from public.config_global cg where cg.id = 1), false));
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'enviados', v_count);
end $function$;

comment on function public.lexph_newsletter_enviar(uuid, timestamptz) is
  'Enqueue masivo del newsletter LexPH. DGG-268 (E-GG-298): excluye la lista fría import_nacional del canal Gmail; se re-habilita cuando config_global.bulk_via_ses=true (marketing por SES, reputación aislada).';
