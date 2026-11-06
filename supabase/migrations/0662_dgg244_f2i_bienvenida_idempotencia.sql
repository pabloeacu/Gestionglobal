-- DGG-244 · F2i — Mail de bienvenida + circuito de suscripción HERMÉTICO (cierre Frente A)
-- ---------------------------------------------------------------------------
-- Requisito de Pablo: el circuito de suscripción no puede entrar en cortocircuito
-- cuando se suscribe alguien que YA está en la lista (incl. los suscriptores
-- iniciales/presuntos: clientes + captación que el Frente B marcará 'confirmado').
--
-- Reglas (hermético):
--  · `email_norm` es UNIQUE → la BD impide físicamente un doble registro.
--  · Nuevo         → circuito normal: mail "confirmá" (token) → al confirmar, "bienvenida".
--  · Ya confirmado → SÓLO el mail de bienvenida ("ya estás dentro", ambiguo), directo,
--                    sin token, sin re-registrar y SIN TOCAR el registro (estado,
--                    confirmed_at, origen, tokens intactos; sólo last_email_at para
--                    el cooldown anti-spam). Nunca el circuito de token de nuevo.
--  · Pendiente     → re-envía "confirmá" si pasó el cooldown (10 min).
--  · Baja          → re-alta explícita (consentimiento nuevo): circuito de confirmación
--                    fresco; al confirmar se limpia la supresión SOFT (baja voluntaria),
--                    nunca la de rebote/queja.
--
-- El mail de bienvenida se envía (a) al confirmar un alta nueva (fin del circuito), y
-- (b) ante un re-intento de suscripción de un mail ya confirmado. Mismo texto → ambiguo.

-- (1) Template de bienvenida (manaxer-v1), idempotente.
insert into public.email_templates
  (slug, nombre, asunto, body_html, from_casilla, kicker, titulo_visual, color_acento,
   mostrar_logo, cuerpo_html_visual, cta_text, cta_url, layout_version, activo)
values (
  'lexph-bienvenida',
  'LexPH · Bienvenida / ya estás suscripto',
  '¡Listo! Ya estás suscripto a LexPH',
  '',
  'general',
  'LexPH · Un servicio de Gestión Global',
  '¡Ya estás dentro!',
  '#009ECA',
  true,
  '<p style="margin:0 0 14px;">¡Gracias por sumarte a <strong>LexPH</strong>! Ya estás en la lista: vas a recibir las novedades de propiedad horizontal —fallos, normativas, vencimientos e insights— destiladas para administrar mejor, cada pocas semanas.</p>'
  || '<p style="margin:0 0 14px;">Mientras tanto, date una vuelta por la edición actual.</p>'
  || '<p style="margin:26px 0 0;font-size:12px;color:#94a3b8;">Si no querías suscribirte, <a href="{{baja_url}}" style="color:#94a3b8;">darte de baja</a> toma un clic.</p>',
  'Leer la edición actual',
  '{{url}}',
  'manaxer-v1',
  true
)
on conflict (slug) do update set
  asunto = excluded.asunto, kicker = excluded.kicker, titulo_visual = excluded.titulo_visual,
  color_acento = excluded.color_acento, mostrar_logo = excluded.mostrar_logo,
  cuerpo_html_visual = excluded.cuerpo_html_visual, cta_text = excluded.cta_text,
  cta_url = excluded.cta_url, layout_version = excluded.layout_version,
  from_casilla = excluded.from_casilla, activo = true, updated_at = now();

-- (2) lexph_suscribir: hermético + bienvenida al ya-confirmado.
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
    insert into public.lexph_suscriptores (email, email_norm, estado)
    values (btrim(p_email), v_norm, 'pendiente')
    returning id, confirm_token, baja_token, email into v_id, v_confirm, v_baja, v_email;
    v_tipo := 'confirmar';
  elsif v_estado = 'confirmado' then
    -- Ya es suscriptor: NO tocar el registro. Sólo "ya estás dentro" (ambiguo), con cooldown.
    if v_cooldown_ok then v_tipo := 'bienvenida'; end if;
  elsif v_estado = 'baja' then
    -- Re-alta explícita → consentimiento nuevo → circuito fresco.
    update public.lexph_suscriptores
       set estado = 'pendiente', baja_at = null, confirm_token = gen_random_uuid()
     where id = v_id
     returning confirm_token into v_confirm;
    v_tipo := 'confirmar';
  else
    -- pendiente: re-enviar confirmación si pasó el cooldown.
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

-- (3) lexph_suscripcion_confirmar: al confirmar → bienvenida + limpiar supresión soft.
create or replace function public.lexph_suscripcion_confirmar(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_id uuid; v_estado text; v_email text; v_baja uuid;
begin
  select id, estado, email, baja_token into v_id, v_estado, v_email, v_baja
  from public.lexph_suscriptores where confirm_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  if v_estado = 'confirmado' then
    -- idempotente: ya estaba confirmado, no re-enviamos bienvenida.
    return jsonb_build_object('ok', true, 'estado', 'confirmado');
  end if;

  update public.lexph_suscriptores
     set estado = 'confirmado', confirmed_at = coalesce(confirmed_at, now()), baja_at = null
   where id = v_id;

  -- re-opt-in: limpiar supresión SOFT (baja voluntaria), nunca rebote/queja.
  delete from public.email_suppression
   where email = lower(btrim(v_email)) and motivo = 'baja_usuario';

  -- bienvenida ("ya estás dentro")
  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  values ('workflow', 'lexph-bienvenida', v_email,
    jsonb_build_object(
      'url',      'https://www.gestionglobal.ar/lexph',
      'baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
    5, 'lexph_suscriptores', v_id, now());
  update public.lexph_suscriptores set last_email_at = now() where id = v_id;

  return jsonb_build_object('ok', true, 'estado', 'confirmado');
end;
$fn$;
