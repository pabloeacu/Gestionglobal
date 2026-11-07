-- DGG-244 F2j — Goteo/loteo del envío masivo del newsletter (≤1500/día, transaccional primero).
-- El envío a la audiencia grande (clientes + captación) no debe inundar la cola ni
-- demorar el transaccional (renovaciones/confirmaciones). Dos palancas:
--  · prioridad 8 (baja): el dispatcher ordena por prioridad ASC → el transaccional
--    (prioridad ≤5) siempre se envía primero; el newsletter usa los slots libres.
--  · programado_para escalonado: a lo sumo 1500 filas quedan "due" por día
--    (floor(rownum/1500) días) → el paquete de ~N se cubre en ceil(N/1500) días.
-- (El throttle global del edge ~1440/día refuerza el techo.) Remitente: contacto@
-- (general) — decisión de Pablo 2026-11-06 (send-as dedicado = riesgo de no-entrega
-- + aislamiento mínimo por IP compartida).
create or replace function public.lexph_newsletter_enviar(p_edicion_id uuid)
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
  c_cap_dia constant int := 1500;  -- tope de envíos "due" por día
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
    set body_html = excluded.body_html,
        asunto = excluded.asunto,
        layout_version = 'legacy',
        from_casilla = 'general',
        activo = true,
        updated_at = now();

  -- Encolar a confirmados no suprimidos, con goteo + prioridad baja.
  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8,  -- prioridad baja: el transaccional (≤5) va primero
         'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.created_at, s.id) - 1) / c_cap_dia))::int * interval '1 day'
    from public.lexph_suscriptores s
   where s.estado = 'confirmado'
     and not exists (
       select 1 from public.email_suppression sup
        where lower(btrim(sup.email)) = s.email_norm
     );
  get diagnostics v_count = row_count;

  update public.lexph_ediciones set newsletter_enviado_at = now() where id = p_edicion_id;

  return jsonb_build_object(
    'ok', true,
    'enviados', v_count,
    'dias', ceil(v_count::numeric / c_cap_dia),
    'reenvio', v_already is not null
  );
end
$fn$;
