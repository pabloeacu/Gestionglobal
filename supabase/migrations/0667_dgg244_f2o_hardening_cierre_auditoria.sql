-- DGG-244 · F2o — Hardening de cierre (hallazgos de la doble auditoría §6 previa al
-- envío masivo). TODO DB-only (no toca la edge money-crítica dispatch-emails → gate R7).
-- Cada bloque cierra un hallazgo CONFIRMADO por la auditoría adversarial:
--
--  [8] lexph_newsletter_enviar: guard contra doble-encolado de una campaña EN CURSO
--      (un click de "Reenviar" encolaba una 2da copia completa → cada persona 2 mails).
--  [9] lexph_newsletter_enviar_especifico: encolaba estado<>'baja' → mandaba a 'pendiente'
--      (nunca confirmó el doble opt-in). Pasa a estado='confirmado' (respeta opt-in).
--  [7] lexph_suscribir: SELECT-luego-INSERT plano en el camino de email NUEVO → dos
--      requests anon concurrentes → unique_violation sin manejar (rompía la respuesta
--      genérica hermética). Pasa a ON CONFLICT DO NOTHING + re-lectura.
--  [2] lexph_newsletter_reporte_tick: rotulaba 'cancelled' como "bajas", pero incluye
--      casillas muertas y opt-outs cross-canal. Separa cancelados vs bajas reales.
--  [4/6] Sweep de supresión: durante el goteo (2-3 días), un opt-out por OTRO canal
--      (email_suppression, cualquier motivo) no cancelaba las filas pendientes del
--      newsletter. Cron que las cancela periódicamente (unifica supresión).

-- =====================================================================
-- [8] Guard de doble-encolado + mantiene todo lo demás igual (CREATE OR REPLACE, misma firma).
-- =====================================================================
create or replace function public.lexph_newsletter_enviar(
  p_edicion_id uuid,
  p_programado_desde timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
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

  -- [8] No re-encolar si ya hay un envío EN CURSO para esta edición (filas pendientes en la
  -- cola). Sin esto, un "Reenviar" mientras el goteo drena duplica el newsletter a cada quien.
  -- Para reenviar legítimamente hay que esperar a que termine (o cancelar las pendientes).
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
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8,
         'lexph_suscriptores', s.id,
         v_desde + (floor((row_number() over (order by s.created_at, s.id) - 1) / c_cap_dia))::int * interval '1 day'
    from public.lexph_suscriptores s
   where s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where lower(btrim(sup.email)) = s.email_norm);
  get diagnostics v_count = row_count;

  update public.lexph_ediciones
     set newsletter_enviado_at = now(), newsletter_reporte_at = null
   where id = p_edicion_id;

  return jsonb_build_object(
    'ok', true, 'enviados', v_count,
    'dias', ceil(v_count::numeric / c_cap_dia),
    'desde', v_desde,
    'reenvio', v_already is not null
  );
end
$fn$;

-- =====================================================================
-- [9] Envío específico: respetar doble opt-in (no mandar a 'pendiente' pre-existente).
--     Los manuales recién insertados entran como 'confirmado' → siguen recibiendo.
-- =====================================================================
create or replace function public.lexph_newsletter_enviar_especifico(
  p_edicion_id uuid,
  p_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_intro   text;
  v_seq     int;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
  c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;
  if p_emails is null or array_length(p_emails, 1) is null then
    raise exception 'No pasaste ningún mail.' using errcode = '22023';
  end if;

  select e.intro, e.seq into v_intro, v_seq from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then raise exception 'Edición no encontrada.' using errcode = 'P0002'; end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar.' using errcode = '22023';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then raise exception 'No se pudo generar el HTML.' using errcode = 'P0002'; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug, 'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH', v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html, asunto = excluded.asunto,
        layout_version = 'legacy', from_casilla = 'general', activo = true, updated_at = now();

  -- 1) asegurar suscriptor por cada email válido no suprimido (hermético). Entran 'confirmado'.
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select distinct on (lower(btrim(e))) btrim(e), lower(btrim(e)), 'confirmado', 'manual', now()
    from unnest(p_emails) e
   where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and not exists (select 1 from public.email_suppression s where s.email = lower(btrim(e)))
   order by lower(btrim(e))
  on conflict (email_norm) do nothing;

  -- 2) encolar SÓLO a confirmados (respeta doble opt-in; un 'pendiente' pre-existente que
  --    nunca confirmó NO recibe por esta vía), no suprimidos, con goteo + dedup contra filas
  --    ya pendientes de esta misma edición (evita doble-click de staff → doble correo).
  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8, 'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.email) - 1) / c_cap_dia))::int * interval '1 day'
    from public.lexph_suscriptores s
   where s.email_norm = any (select distinct lower(btrim(e)) from unnest(p_emails) e
                             where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     and s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where sup.email = s.email_norm)
     and not exists (select 1 from public.email_queue q2
                      where q2.template_slug = v_slug and q2.enviado_at is null
                        and lower(btrim(q2.to_email)) = s.email_norm);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'enviados', v_count);
end
$fn$;

-- =====================================================================
-- [7] lexph_suscribir hermético ante concurrencia (camino email NUEVO).
-- =====================================================================
create or replace function public.lexph_suscribir(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_norm    text := lower(btrim(coalesce(p_email, '')));
  v_id      uuid;
  v_estado  text;
  v_last    timestamptz;
  v_confirm uuid;
  v_baja    uuid;
  v_email   text;
  v_tipo    text := null;              -- 'confirmar' | 'bienvenida'
  v_cooldown_ok boolean;
begin
  if v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_norm) > 254 then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;

  select id, estado, last_email_at, confirm_token, baja_token, email
    into v_id, v_estado, v_last, v_confirm, v_baja, v_email
  from public.lexph_suscriptores where email_norm = v_norm;

  v_cooldown_ok := (v_last is null or v_last < now() - interval '10 minutes');

  if v_id is null then
    -- Camino NUEVO con guard de carrera: ON CONFLICT DO NOTHING. Si otro request lo insertó
    -- entre el SELECT y el INSERT, re-leemos y lo tratamos como existente (hermético:
    -- sin unique_violation al anon, sin doble registro, respuesta genérica preservada).
    insert into public.lexph_suscriptores (email, email_norm, estado)
    values (btrim(p_email), v_norm, 'pendiente')
    on conflict (email_norm) do nothing
    returning id, confirm_token, baja_token, email into v_id, v_confirm, v_baja, v_email;

    if v_id is not null then
      v_tipo := 'confirmar';
    else
      select id, estado, last_email_at, confirm_token, baja_token, email
        into v_id, v_estado, v_last, v_confirm, v_baja, v_email
      from public.lexph_suscriptores where email_norm = v_norm;
      v_cooldown_ok := (v_last is null or v_last < now() - interval '10 minutes');
      if v_estado = 'confirmado' then
        if v_cooldown_ok then v_tipo := 'bienvenida'; end if;
      elsif v_estado = 'baja' then
        update public.lexph_suscriptores
           set estado = 'pendiente', baja_at = null, confirm_token = gen_random_uuid()
         where id = v_id
         returning confirm_token into v_confirm;
        v_tipo := 'confirmar';
      else
        if v_cooldown_ok then v_tipo := 'confirmar'; end if;
      end if;
    end if;
  elsif v_estado = 'confirmado' then
    if v_cooldown_ok then v_tipo := 'bienvenida'; end if;
  elsif v_estado = 'baja' then
    update public.lexph_suscriptores
       set estado = 'pendiente', baja_at = null, confirm_token = gen_random_uuid()
     where id = v_id
     returning confirm_token into v_confirm;
    v_tipo := 'confirmar';
  else
    if v_cooldown_ok then v_tipo := 'confirmar'; end if;
  end if;

  if v_tipo = 'confirmar' then
    insert into public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    values ('workflow', 'lexph-confirmar-suscripcion', v_email,
      jsonb_build_object(
        'confirm_url', 'https://www.gestionglobal.ar/lexph/confirmar?token=' || v_confirm,
        'baja_url',    'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
      5, 'lexph_suscriptores', v_id, now());
    update public.lexph_suscriptores set last_email_at = now() where id = v_id;
  elsif v_tipo = 'bienvenida' then
    insert into public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    values ('workflow', 'lexph-bienvenida', v_email,
      jsonb_build_object(
        'url',      'https://www.gestionglobal.ar/lexph',
        'baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
      5, 'lexph_suscriptores', v_id, now());
    update public.lexph_suscriptores set last_email_at = now() where id = v_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- =====================================================================
-- [2] Informe final: separar cancelados totales vs bajas reales (por el link del newsletter).
-- =====================================================================
create or replace function private.lexph_newsletter_reporte_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_ed   record;
  v_slug text;
  v_tot int; v_sent int; v_fail int; v_canc int; v_bajas int; v_pend int;
begin
  for v_ed in
    select id, seq from public.lexph_ediciones
     where newsletter_enviado_at is not null and newsletter_reporte_at is null
  loop
    v_slug := 'lexph-newsletter-e' || coalesce(v_ed.seq::text, replace(v_ed.id::text, '-', ''));
    select count(*),
           count(*) filter (where status = 'sent'),
           count(*) filter (where status = 'failed'),
           count(*) filter (where status = 'cancelled'),
           count(*) filter (where status = 'cancelled' and ultimo_error ilike '%baja%'),
           count(*) filter (where enviado_at is null)
      into v_tot, v_sent, v_fail, v_canc, v_bajas, v_pend
      from public.email_queue where template_slug = v_slug;

    if v_tot > 0 and v_pend = 0 then
      perform private.notif_emitir_staff(
        'lexph_suscriptor',
        'Informe final · Envío de LexPH completado',
        format('Edición N°%s: entregados %s · fallidos %s · cancelados %s (de ellos, bajas %s) · total %s.',
               coalesce(v_ed.seq::text, '—'), v_sent, v_fail, v_canc, v_bajas, v_tot),
        '/gerencia/contenidos/suscriptores',
        jsonb_build_object('edicion_id', v_ed.id, 'enviados', v_sent,
                           'fallidos', v_fail, 'cancelados', v_canc, 'bajas', v_bajas, 'total', v_tot)
      );
      update public.lexph_ediciones set newsletter_reporte_at = now() where id = v_ed.id;
    end if;
  end loop;
end
$fn$;

-- =====================================================================
-- [4/6] Sweep de supresión durante el goteo: cancela filas PENDIENTES del newsletter cuyo
--       destinatario quedó en email_suppression por CUALQUIER canal/motivo (baja_usuario de
--       otro canal, bounce, queja, manual). Complementa la cancelación inline de
--       lexph_suscripcion_baja (que sólo cubre la baja por el link del propio newsletter) y
--       el hard-block que el edge ya re-chequea. Unifica supresión (objetivo del proyecto).
-- =====================================================================
create or replace function private.lexph_newsletter_supresion_sweep()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  update public.email_queue q
     set status = 'cancelled', enviado_at = now(),
         ultimo_error = 'suprimido durante la campaña (sweep cross-canal)'
   where q.enviado_at is null
     and q.status = 'pending'
     and q.template_slug like 'lexph-newsletter-e%'
     and exists (
       select 1 from public.email_suppression s
        where s.email = lower(btrim(q.to_email))
     );
end
$fn$;

do $$ begin
  perform cron.unschedule('lexph-newsletter-supresion-sweep');
exception when others then null; end $$;
select cron.schedule('lexph-newsletter-supresion-sweep', '*/15 * * * *',
                     'select private.lexph_newsletter_supresion_sweep();');
