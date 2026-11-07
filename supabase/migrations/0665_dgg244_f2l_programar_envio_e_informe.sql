-- DGG-244 · F2l — Programar el envío + baja mid-campaña + informe final automático
-- ---------------------------------------------------------------------------
-- (a) `lexph_newsletter_enviar(edicion, p_programado_desde)` — se agrega el ancla
--     del goteo (default now()). Permite ENCOLAR el envío ahora pero que recién
--     empiece a salir en la fecha indicada (p. ej. mañana 7:00 ART). El dispatcher
--     existente drena las filas cuando `programado_para <= now()` — no hace falta
--     cron nuevo para arrancar. R16: se DROPea la firma vieja (1 arg) antes de crear
--     la nueva (2 args con default) para no dejar overload ambiguo.
-- (b) Baja durante la campaña → se cancelan las filas de newsletter PENDIENTES de
--     ese destinatario. Sin esto, alguien que se da de baja el día 1 igual recibiría
--     los días 2/3 (el edge no filtra supresión para el newsletter, que no es
--     "marketing" flaggeado). Cierra el hueco de consentimiento del goteo.
-- (c) Informe final: al completarse la campaña (0 filas pendientes), se avisa a
--     gerencia con las estadísticas (entregados/fallidos/bajas). Idempotente
--     (columna `newsletter_reporte_at`), vía cron horario.

-- (a) ----------------------------------------------------------------------
drop function if exists public.lexph_newsletter_enviar(uuid);

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
  v_desde   timestamptz := greatest(p_programado_desde, now());  -- nunca en el pasado
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

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then
    raise exception 'No se pudo generar el HTML del newsletter.' using errcode = 'P0002';
  end if;

  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

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

  -- Reabrir el ciclo de informe para esta edición (por si se re-dispara).
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

-- (b) ----------------------------------------------------------------------
create or replace function public.lexph_suscripcion_baja(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_id    uuid;
  v_email text;
begin
  select id, email into v_id, v_email
    from public.lexph_suscriptores where baja_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;

  update public.lexph_suscriptores
     set estado = 'baja', baja_at = now()
   where id = v_id;

  insert into public.email_suppression (email, motivo, origen)
  values (lower(btrim(v_email)), 'baja_usuario', 'lexph')
  on conflict (email) do nothing;

  -- Cancelar los envíos de newsletter PENDIENTES de este destinatario (goteo en curso).
  update public.email_queue
     set status = 'cancelled', enviado_at = now(),
         ultimo_error = 'suscriptor dado de baja durante la campaña'
   where lower(btrim(to_email)) = lower(btrim(v_email))
     and enviado_at is null
     and template_slug like 'lexph-newsletter-e%';

  return jsonb_build_object('ok', true, 'estado', 'baja');
end
$fn$;

-- (c) ----------------------------------------------------------------------
alter table public.lexph_ediciones add column if not exists newsletter_reporte_at timestamptz;

create or replace function private.lexph_newsletter_reporte_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_ed   record;
  v_slug text;
  v_tot int; v_sent int; v_fail int; v_canc int; v_pend int;
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
           count(*) filter (where enviado_at is null)
      into v_tot, v_sent, v_fail, v_canc, v_pend
      from public.email_queue where template_slug = v_slug;

    if v_tot > 0 and v_pend = 0 then
      perform private.notif_emitir_staff(
        'lexph_suscriptor',
        'Informe final · Envío de LexPH completado',
        format('Edición N°%s: entregados %s · fallidos %s · bajas durante la campaña %s (total %s).',
               coalesce(v_ed.seq::text, '—'), v_sent, v_fail, v_canc, v_tot),
        '/gerencia/contenidos/suscriptores',
        jsonb_build_object('edicion_id', v_ed.id, 'enviados', v_sent,
                           'fallidos', v_fail, 'bajas', v_canc, 'total', v_tot)
      );
      update public.lexph_ediciones set newsletter_reporte_at = now() where id = v_ed.id;
    end if;
  end loop;
end
$fn$;

do $$ begin
  perform cron.unschedule('lexph-newsletter-reporte');
exception when others then null; end $$;
select cron.schedule('lexph-newsletter-reporte', '7 * * * *', 'select private.lexph_newsletter_reporte_tick();');
