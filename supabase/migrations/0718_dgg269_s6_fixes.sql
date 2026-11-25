-- 0718 · DGG-269 §6 fixes (doble auditoría 3 agentes). Todos los hallazgos SQL/frontend del
-- chunk, resueltos in-situ (premisa de cierre #0). Latentes tras el gate pero correctos ya:
--  C#1 (CRÍTICO): el trigger private.prospecto_registrar_mail filtra 'captacion-%' → los
--    'federal-%' NUNCA se registran en prospecto_mails ni setean ultimo_mail_*/contactado →
--    KPIs "contactados"/"último mail"/campanas_enviadas en 0 y COOLDOWN 90d inerte al enviar.
--    (Reaparición de la lección E-0571.) Fix: ampliar a 'federal-%'.
--  A#3 (menor): preview_campana no tenía SET TimeZone → el borde gracia/cooldown casteaba en
--    UTC vs enviar_campana en -03 (skew 3h, "preview miente" en el borde). Fix: igualar TZ.
--  A#4 (menor): KPI "otro" usaba `is distinct from CABA/PBA` mientras el chip/filtro usa
--    ='OTRO'. Fix: alinear a ='OTRO' (invariante del import: jurisdiccion ∈ CABA/PBA/OTRO).
--  C#6 (menor): federal-rpa-caba (invitación a CURSO) salía de from_casilla='general' →
--    replies a contacto@; corresponde cursos@. Fix: from_casilla='cursos'.
--  B#12 (cosm.): grant service_role en enviar_campana (sin cron federal) → superficie muerta.

-- ───────── C#1 · trigger: registrar también los mails federales ─────────
create or replace function private.prospecto_registrar_mail()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_pid uuid;
begin
  if NEW.to_email is null then return null; end if;
  -- Outreach a prospectos: captación PBA + captación federal (DGG-269). El resto (transaccional,
  -- avisos, newsletter) NO se registra acá.
  if coalesce(NEW.template_slug,'') not like 'captacion-%'
     and coalesce(NEW.template_slug,'') not like 'federal-%' then
    return null;
  end if;
  select id into v_pid from public.prospectos where email = lower(btrim(NEW.to_email)) limit 1;
  if v_pid is null then return null; end if;
  insert into public.prospecto_mails (prospecto_id, template_slug, asunto, enviado_at)
  values (v_pid, NEW.template_slug, NEW.asunto, coalesce(NEW.enviado_at, now()));
  update public.prospectos
     set ultimo_mail_slug = NEW.template_slug, ultimo_mail_asunto = NEW.asunto,
         ultimo_mail_at = coalesce(NEW.enviado_at, now()),
         estado_captacion = case when estado_captacion = 'nuevo' then 'contactado' else estado_captacion end,
         updated_at = now()
   where id = v_pid;
  return null;
end $fn$;

-- ───────── A#3 + A#4 · KPIs: TZ no hace falta (usa `at time zone` explícito), pero alineo "otro" ─────────
create or replace function public.prospectos_federal_kpis()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; v_res jsonb;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  with base as (
    select p.*, public.email_esta_suprimido(p.email) as suprimido,
           (p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid') as email_ok
    from public.prospectos p where p.origen = 'import_nacional'
  )
  select jsonb_build_object(
    'total',        count(*),
    'caba',         count(*) filter (where jurisdiccion = 'CABA'),
    'pba',          count(*) filter (where jurisdiccion = 'PBA'),
    'otro',         count(*) filter (where jurisdiccion = 'OTRO'),
    'con_email',    count(*) filter (where email_ok),
    'suprimidos',   count(*) filter (where suprimido),
    'contactados',  count(*) filter (where ultimo_mail_at is not null),
    'convertidos',  count(*) filter (where convertido_at is not null),
    'bajas',        count(*) filter (where baja_at is not null),
    'activo',       (select coalesce(federal_campanas_activo,false) from public.config_global limit 1),
    'enviados_total', (select count(*) from public.prospecto_mails pm
                        join public.prospectos p2 on p2.id=pm.prospecto_id
                        where p2.origen='import_nacional' and pm.template_slug like 'federal-%'),
    'encolados_hoy', (select count(*) from public.email_queue q
                        join public.prospectos p3 on p3.id=q.related_id and q.related_table='prospectos'
                        where p3.origen='import_nacional' and q.template_slug like 'federal-%'
                          and (q.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'cola_pendiente', (select count(*) from public.email_queue q
                        join public.prospectos p4 on p4.id=q.related_id and q.related_table='prospectos'
                        where p4.origen='import_nacional' and q.template_slug like 'federal-%' and q.enviado_at is null),
    'hoy',          v_hoy
  ) into v_res from base;
  return v_res;
end $fn$;

-- ───────── A#3 · preview: mismo TimeZone que enviar para que el borde gracia/cooldown coincida ─────────
create or replace function public.prospectos_federal_preview_campana(
  p_template_slug text, p_jurisdiccion text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
  set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $fn$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
        v_gracia int := 30; v_cooldown int := 90; v_existe boolean; v_res jsonb;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  select exists(select 1 from public.email_templates where slug=p_template_slug and activo) into v_existe;
  with seg as (
    select p.id, p.email,
           (p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid') as email_ok
    from public.prospectos p
    where p.origen='import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and p.convertido_at is null and p.baja_at is null
      and p.estado_captacion is distinct from 'no_interesado'
  ), eval as (
    select s.id, s.email_ok,
           case when not s.email_ok then false else public.email_esta_suprimido(s.email) end as supr,
           exists(select 1 from public.prospecto_mails pm where pm.prospecto_id=s.id and pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             or exists(select 1 from public.email_queue q where q.related_table='prospectos' and q.related_id=s.id and q.created_at >= (v_hoy - v_gracia)::timestamptz) as en_gracia,
           exists(select 1 from public.prospecto_mails pm where pm.prospecto_id=s.id and pm.template_slug=p_template_slug and pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) as en_cooldown
    from seg s
  )
  select jsonb_build_object(
    'template', p_template_slug, 'template_existe', v_existe, 'jurisdiccion', p_jurisdiccion,
    'en_segmento', count(*),
    'sin_email',   count(*) filter (where not email_ok),
    'suprimidos',  count(*) filter (where email_ok and supr),
    'en_gracia',   count(*) filter (where email_ok and not supr and en_gracia),
    'en_cooldown', count(*) filter (where email_ok and not supr and not en_gracia and en_cooldown),
    'elegibles',   count(*) filter (where email_ok and not supr and not en_gracia and not en_cooldown)
  ) into v_res from eval;
  return v_res;
end $fn$;

-- ───────── C#6 · el curso responde a cursos@ ─────────
update public.email_templates set from_casilla='cursos', updated_at=now() where slug='federal-rpa-caba';

-- ───────── B#12 · quitar grant service_role muerto (no hay cron federal) ─────────
revoke execute on function public.prospectos_federal_enviar_campana(text,text,int,boolean) from service_role;
