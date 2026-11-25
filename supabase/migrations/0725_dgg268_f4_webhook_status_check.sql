-- 0725 · DGG-268 F4 — Fix del estampado de webhook_status en ses_feedback_ingest.
--
-- El CHECK sent_emails_webhook_status_check permite sólo NULL | enviado | entregado |
-- abierto | clickeado | rebotado. El 0724 (y ya el 0721) seteaban 'queja' para complaint y
-- 0724 agregó 'rebote_transitorio' → AMBOS violan el CHECK en runtime: una queja o un rebote
-- transitorio con sent_emails matcheado por provider_msg_id abortaría la RPC → el webhook
-- devolvería 500 y SNS reintentaría en loop sin procesar nunca. (Latente: el webhook aún no
-- está deployado; lo destapó el smoke e2e del 0724.)
--
-- FIX: webhook_status (campo COARSE de entrega) toma sólo valores permitidos — 'rebotado'
-- (bounce permanente), 'entregado' (delivery). La QUEJA y el rebote TRANSITORIO dejan
-- webhook_status intacto; su estado preciso vive en sent_emails.estado ('complained') +
-- complained_at + el log events/ses_feedback_events. (La convención del sistema para quejas
-- es estado='complained', no webhook_status.)
--
-- R16: misma firma (sin overload). R18: smoke e2e re-corrido tras el cambio.

create or replace function public.ses_feedback_ingest(
  p_sns_message_id  text,
  p_tipo            text,
  p_subtipo         text,
  p_es_permanente   boolean,
  p_emails          text[],
  p_provider_msg_id text,
  p_feedback_id     text,
  p_event_at        timestamptz,
  p_payload         jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_email      text;
  v_norm       text;
  v_prospecto  uuid;
  v_motivo     text;
  v_event_type text;
  v_suppress   boolean;
  v_suprimidos integer := 0;
  v_stamped    integer := 0;
  v_clientes   jsonb := '[]'::jsonb;
  r_admin      record;
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

  v_suppress   := (p_tipo = 'complaint')
               or (p_tipo = 'bounce' and coalesce(p_es_permanente, false));
  v_motivo     := case when p_tipo = 'complaint' then 'queja' else 'bounce' end;
  v_event_type := case
    when p_tipo = 'complaint' then 'complained'
    when p_tipo = 'bounce' and coalesce(p_es_permanente, false) then 'bounced'
    when p_tipo = 'bounce' then 'bounce_transitorio'
    when p_tipo = 'delivery' then 'delivered'
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
      bounced_at    = case when v_event_type = 'bounced'    then coalesce(se.bounced_at,    p_event_at) else se.bounced_at end,
      complained_at = case when v_event_type = 'complained' then coalesce(se.complained_at, p_event_at) else se.complained_at end,
      estado = case
        when se.estado = 'complained' then 'complained'
        when v_event_type = 'complained' then 'complained'
        when v_event_type = 'bounced' then 'bounced'
        when v_event_type = 'delivered' and se.estado = 'sent' then 'delivered'
        else se.estado end,
      -- webhook_status es COARSE y su CHECK sólo admite enviado/entregado/abierto/clickeado/rebotado.
      -- Sólo lo tocan el bounce PERMANENTE y el delivery; queja y transient lo dejan intacto.
      webhook_status = case
        when v_event_type = 'bounced'   then 'rebotado'
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

    for r_admin in
      select id, email, nombre from public.administraciones
       where lower(btrim(email)) = v_norm and estado <> 'baja'
    loop
      v_clientes := v_clientes || jsonb_build_array(jsonb_build_object(
        'administracion_id', r_admin.id, 'email', r_admin.email, 'nombre', r_admin.nombre));
    end loop;
  end loop;

  update public.ses_feedback_events set suprimidos = v_suprimidos where sns_message_id = p_sns_message_id;

  return jsonb_build_object('duplicate', false, 'suprimidos', v_suprimidos, 'stamped', v_stamped,
                            'clientes', v_clientes, 'tipo', p_tipo, 'motivo', v_motivo);
end
$fn$;
