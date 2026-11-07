-- DGG-244 F2n — Envío del newsletter a MAILS ESPECÍFICOS (ad-hoc), reusando el render
-- y el goteo. Asegura un suscriptor por email (hermético, ON CONFLICT DO NOTHING) para
-- tener baja_token, saltea suprimidos, encola con prioridad 8 + goteo ≤1500/día.
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

  -- 1) asegurar suscriptor por cada email válido no suprimido (hermético).
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select distinct on (lower(btrim(e))) btrim(e), lower(btrim(e)), 'confirmado', 'manual', now()
    from unnest(p_emails) e
   where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and not exists (select 1 from public.email_suppression s where s.email = lower(btrim(e)))
   order by lower(btrim(e))
  on conflict (email_norm) do nothing;

  -- 2) encolar a esos mails (ya visibles), no baja, no suprimidos, con goteo.
  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8, 'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.email) - 1) / c_cap_dia))::int * interval '1 day'
    from public.lexph_suscriptores s
   where s.email_norm = any (select distinct lower(btrim(e)) from unnest(p_emails) e
                             where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     and s.estado <> 'baja'
     and not exists (select 1 from public.email_suppression sup where sup.email = s.email_norm);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'enviados', v_count);
end
$fn$;
