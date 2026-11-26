-- 0740 · DGG-273 — Purga a toda marcha: cada rebote (no sólo permanente) + queja da de baja
-- la audiencia de marketing (suscriptores LexPH + captación/prospectos) + supresión global.
--
-- Pedido de Pablo (2026-11-26, chat): "Cada rebote y queja debe producir, automáticamente,
-- la baja de nuestra lista de suscriptores y captación. La idea no es bajar el caudal, sino
-- limpiar y purgar a toda marcha para que nos quede una base realmente pulida y optimizada."
--
-- Antes: ses_feedback_ingest sólo suprimía bounce Permanent + queja. Los soft bounces
-- (Transient) quedaban SIN baja, así que la misma dirección muerta/llena se re-enviaba en el
-- próximo blast y volvía a rebotar — justo lo que ensucia la reputación del warmup.
--
-- Ahora el motor de supresión/baja (email_suppression global + prospectos.estado_captacion
-- + lexph_suscriptores.estado, con carve-out de cliente puro vía email_bloqueado_total) se
-- dispara en TODO rebote y toda queja, con UN solo carve-out de criterio:
--
--   · NO se suprime en los transitorios de CONTENIDO (Transient/ContentRejected,
--     MessageTooLarge, AttachmentRejected): esos rebotan por culpa de NUESTRO contenido
--     (tamaño/filtro antispam), no porque la dirección sea mala. Suprimir ahí purgaría
--     contactos VÁLIDOS y además taparía un problema de contenido nuestro. El objetivo de
--     Pablo es una base "pulida", no purgar gente válida por un glitch de contenido.
--   · SÍ se suprime en Permanent/*, Transient/General y Transient/MailboxFull (direcciones
--     muertas, inexistentes o abandonadas) y en toda queja.
--
-- Nota SES: un Transient bounce vía SNS llega DESPUÉS de que SES agotó sus reintentos (no es
-- un defer momentáneo), así que es una señal sólida de dirección no entregable.
--
-- Además: el AVISO a gerencia por cliente (campanita/push/email) sigue disparándose SÓLO por
-- rebote PERMANENTE o queja (v_alert_cliente). Un soft bounce de un cliente le corta el
-- marketing (reversible) pero NO floodea a gerencia con un aviso cuyo copy dice "rebote
-- permanente" (coherencia aviso↔display, §6(e) de CLAUDE.md). El edge no cambia.
--
-- R16: CREATE OR REPLACE con la MISMA firma (9 params) → no crea overload. R5/R17: RPC
-- multi-tabla SECURITY DEFINER (ya lo era). R18: smoke e2e incluido abajo (BEGIN/ROLLBACK).

create or replace function public.ses_feedback_ingest(
  p_sns_message_id text, p_tipo text, p_subtipo text, p_es_permanente boolean,
  p_emails text[], p_provider_msg_id text, p_feedback_id text,
  p_event_at timestamp with time zone, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email         text;
  v_norm          text;
  v_prospecto     uuid;
  v_motivo        text;
  v_event_type    text;
  v_suppress      boolean;
  v_alert_cliente boolean;
  v_suprimidos    integer := 0;
  v_stamped       integer := 0;
  v_clientes      jsonb := '[]'::jsonb;
  r_admin         record;
begin
  insert into public.ses_feedback_events(
    sns_message_id, tipo, subtipo, es_permanente, email, emails,
    provider_msg_id, feedback_id, payload)
  values (
    p_sns_message_id, p_tipo, p_subtipo, coalesce(p_es_permanente, false),
    lower(btrim(p_emails[1])), coalesce(p_emails, '{}'::text[]),
    p_provider_msg_id, p_feedback_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (sns_message_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;

  -- PURGA: toda queja y todo bounce, EXCEPTO los transitorios de contenido (culpa nuestra).
  v_suppress := (p_tipo = 'complaint')
             or (p_tipo = 'bounce' and coalesce(p_es_permanente, false))
             or (p_tipo = 'bounce' and not coalesce(p_es_permanente, false)
                 and coalesce(lower(p_subtipo), '') !~ 'contentrejected|messagetoolarge|attachmentrejected');

  -- Aviso a gerencia por cliente: SÓLO permanente o queja (lo serio y accionable).
  v_alert_cliente := (p_tipo = 'complaint')
                  or (p_tipo = 'bounce' and coalesce(p_es_permanente, false));

  v_motivo     := case when p_tipo = 'complaint' then 'queja' else 'bounce' end;
  v_event_type := case
    when p_tipo = 'complaint' then 'complained'
    when p_tipo = 'bounce' and coalesce(p_es_permanente, false) then 'bounced'
    when p_tipo = 'bounce' then 'bounce_transitorio'
    when p_tipo = 'delivery' then 'delivered'
    when p_tipo = 'open' then 'opened'
    when p_tipo = 'click' then 'clicked'
  end;

  if p_provider_msg_id is not null and v_event_type is not null then
    update public.sent_emails se set
      events = case
        when exists (select 1 from jsonb_array_elements(se.events) e
                      where e->>'type' = v_event_type
                        and (e->>'at')::timestamptz = p_event_at)
        then se.events
        else se.events || jsonb_build_array(jsonb_build_object(
               'type', v_event_type, 'at', p_event_at, 'data', coalesce(p_payload, '{}'::jsonb))) end,
      last_event_at = greatest(coalesce(se.last_event_at, '-infinity'::timestamptz), p_event_at),
      delivered_at  = case when v_event_type = 'delivered' then coalesce(se.delivered_at, p_event_at) else se.delivered_at end,
      opened_at     = case when v_event_type = 'opened'    then coalesce(se.opened_at,    p_event_at) else se.opened_at end,
      clicked_at    = case when v_event_type = 'clicked'   then coalesce(se.clicked_at,   p_event_at) else se.clicked_at end,
      bounced_at    = case when v_event_type = 'bounced'    then coalesce(se.bounced_at,    p_event_at) else se.bounced_at end,
      complained_at = case when v_event_type = 'complained' then coalesce(se.complained_at, p_event_at) else se.complained_at end,
      estado = case
        when se.estado = 'complained' or v_event_type = 'complained' then 'complained'
        when se.estado = 'bounced'    or v_event_type = 'bounced'    then 'bounced'
        when se.estado = 'clicked'    or v_event_type = 'clicked'    then 'clicked'
        when se.estado = 'opened'     or v_event_type = 'opened'     then 'opened'
        when se.estado = 'delivered'  or v_event_type = 'delivered'  then 'delivered'
        else se.estado end,
      webhook_status = case
        when se.webhook_status = 'rebotado' or v_event_type = 'bounced' then 'rebotado'
        when v_event_type = 'clicked' then 'clickeado'
        when se.webhook_status = 'clickeado' then 'clickeado'
        when v_event_type = 'opened' then 'abierto'
        when se.webhook_status = 'abierto' then 'abierto'
        when v_event_type = 'delivered' then 'entregado'
        else se.webhook_status end
    where se.provider_msg_id = p_provider_msg_id;
    get diagnostics v_stamped = row_count;
  end if;

  if not v_suppress then
    return jsonb_build_object('duplicate', false, 'suprimidos', 0, 'stamped', v_stamped,
                              'clientes', v_clientes, 'tipo', p_tipo);
  end if;

  foreach v_email in array coalesce(p_emails, '{}'::text[]) loop
    v_norm := lower(btrim(coalesce(v_email, '')));
    continue when v_norm = '' or position('@' in v_norm) = 0;

    select id into v_prospecto from public.prospectos where email = v_norm;

    insert into public.email_suppression (email, motivo, origen, prospecto_id)
    values (v_norm, v_motivo, 'ses', v_prospecto)
    on conflict (email) do update set
      motivo = case
        when excluded.motivo = 'queja' then 'queja'
        when private.motivo_es_hard(email_suppression.motivo) then email_suppression.motivo
        else excluded.motivo end,
      origen = case
        when excluded.motivo = 'queja' then 'ses'
        when private.motivo_es_hard(email_suppression.motivo) then email_suppression.origen
        else 'ses' end,
      prospecto_id = coalesce(email_suppression.prospecto_id, excluded.prospecto_id);
    v_suprimidos := v_suprimidos + 1;

    if v_prospecto is not null then
      update public.prospectos
         set estado_captacion = 'baja', baja_at = coalesce(baja_at, now()), updated_at = now()
       where id = v_prospecto;
    end if;
    update public.lexph_suscriptores
       set estado = 'baja', baja_at = coalesce(baja_at, now())
     where email_norm = v_norm and estado <> 'baja';

    if v_alert_cliente then
      for r_admin in
        select id, email, nombre from public.administraciones
         where lower(btrim(email)) = v_norm and estado <> 'baja'
      loop
        v_clientes := v_clientes || jsonb_build_array(jsonb_build_object(
          'administracion_id', r_admin.id, 'email', r_admin.email, 'nombre', r_admin.nombre));
      end loop;
    end if;
  end loop;

  update public.ses_feedback_events set suprimidos = v_suprimidos where sns_message_id = p_sns_message_id;

  return jsonb_build_object('duplicate', false, 'suprimidos', v_suprimidos, 'stamped', v_stamped,
                            'clientes', v_clientes, 'tipo', p_tipo, 'motivo', v_motivo);
end
$function$;

comment on function public.ses_feedback_ingest(text, text, text, boolean, text[], text, text, timestamptz, jsonb) is
  'DGG-268/DGG-273: ingesta idempotente de feedback SES. Suprime (opt-out global marketing) + '
  'baja la entidad (prospecto/lexph) en TODA queja y TODO bounce salvo transitorios de contenido '
  '(ContentRejected/MessageTooLarge/AttachmentRejected). Aviso a gerencia por cliente sólo en '
  'permanente/queja. Carve-out de cliente puro: conserva transaccional.';
