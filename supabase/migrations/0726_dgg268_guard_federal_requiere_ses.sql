-- 0726 · DGG-268 — Guard: la Captación Federal sólo sale por el carril SES.
--
-- La doble auditoría §6 (E-GG-298) encontró una SEGUNDA canilla de reputación a la lista fría
-- import_nacional por Gmail: prospectos_federal_enviar_campana encolaba import_nacional gateada
-- SÓLO por config_global.federal_campanas_activo, sin atar a bulk_via_ses. El dispatcher clasifica
-- federal-* como marketing; con bulk_via_ses=false → routeSes=false → saldría por Gmail. Un flip de
-- federal_campanas_activo con SES apagado repetiría el incidente del 25/11 (blast de ~10k frías por
-- la cuenta compartida con los comprobantes). Es el gemelo exacto del newsletter (guard 0722), que
-- se me pasó al blindar un productor del mismo universo frío y no el otro (miss de fan-out §6-2bis-a).
--
-- FIX fail-closed: la Captación Federal (cuya audiencia ES import_nacional) requiere bulk_via_ses
-- activo (reputación aislada en SES) para encolar. Sin eso, devuelve gated y NO encola nada —
-- NUNCA por Gmail. Backend-enforced (no salteable por UI/import/retry). R16: misma firma, sin overload.

create or replace function public.prospectos_federal_enviar_campana(p_template_slug text, p_jurisdiccion text default null::text, p_limite_diario integer default 1500, p_forzar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_cap int := least(greatest(coalesce(p_limite_diario,1500),1),5000);
  v_asunto text; v_toques int := 0; v_p record; v_rn int := 0; v_pila text;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_template_slug is null or p_template_slug not like 'federal-%' then
    return jsonb_build_object('ok', false, 'error', 'template_no_federal');
  end if;
  if not (select coalesce(federal_campanas_activo, false) from public.config_global limit 1) then
    return jsonb_build_object('ok', false, 'error', 'federal_desactivado', 'gated', true, 'encolados', 0);
  end if;
  -- DGG-268 (E-GG-298): la lista fría import_nacional NO sale por Gmail (castiga la reputación de
  -- los comprobantes). La Captación Federal sólo se despacha por el carril SES (reputación aislada).
  if not (select coalesce(bulk_via_ses, false) from public.config_global limit 1) then
    return jsonb_build_object('ok', false, 'error', 'requiere_ses', 'gated', true, 'encolados', 0,
      'detalle', 'Captación Federal (lista fría nacional) sólo sale por el carril SES. Activá bulk_via_ses (reputación aislada) antes de enviar; nunca por Gmail.');
  end if;
  select asunto into v_asunto from public.email_templates where slug = p_template_slug and activo;
  if v_asunto is null then return jsonb_build_object('ok', false, 'error', 'template_inexistente'); end if;

  for v_p in
    select p.id, p.nombre, p.email
    from public.prospectos p
    where p.origen = 'import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and p.convertido_at is null and p.baja_at is null
      and p.estado_captacion is distinct from 'no_interesado'
      and p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid'
    order by p.email
  loop
    continue when public.email_esta_suprimido(v_p.email);
    continue when exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             or exists (select 1 from public.email_queue q
                         where q.related_table = 'prospectos' and q.related_id = v_p.id
                           and q.created_at >= (v_hoy - v_gracia)::timestamptz);
    continue when not p_forzar and exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.template_slug = p_template_slug
                             and pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_pila := coalesce(public.nombre_pila_federal(v_p.nombre), 'colega');
    insert into public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    values
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre),
       jsonb_build_object('nombre', v_pila), 8,
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1; v_rn := v_rn + 1;
  end loop;

  return jsonb_build_object('ok', true, 'encolados', v_toques,
    'dias', ceil(v_toques::numeric / v_cap)::int, 'template', p_template_slug,
    'jurisdiccion', p_jurisdiccion, 'cap_diario', v_cap, 'forzado', p_forzar);
end $function$;
