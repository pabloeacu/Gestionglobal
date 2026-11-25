-- 0721 · DGG-268 F4 — Rebotes y quejas de Amazon SES → SNS → webhook → supresión unificada.
--
-- Cierra el pendiente #1 del gate (knowledge-base/AUDITORIA_HIBRIDO_SES.md punto 5):
-- los rebotes PERMANENTES y las QUEJAS de SES ahora alimentan email_suppression
-- (opt-out GLOBAL, convención DGG-256/267) igual que el harvester de DSN de Gmail,
-- con trazabilidad e idempotencia por SNS MessageId (gate punto 7).
--
-- Reglas aplicadas:
--  · R5  — escritura multi-tabla ⇒ RPC plpgsql SECURITY DEFINER + SET search_path.
--  · R6  — tabla nueva con RLS habilitada + GRANTs explícitos.
--  · R11 — índice en el lookup caliente (sent_emails.provider_msg_id) del match evento↔envío.
--  · R16 — email_bloqueado_total se RE-CREA con la MISMA firma (p_email text) → sin overload.
--  · R18 — smoke e2e del INSERT de la RPC (se corre aparte, BEGIN/…/ROLLBACK forzado).
--  · R19 — coherencia de panel: suprimir un rebote TAMBIÉN baja la entidad
--          (prospectos.estado_captacion / lexph_suscriptores.estado), no sólo inserta en
--          suppression (si no, el panel contaría casillas muertas como activas).
--
-- Decisiones:
--  · origen='ses' (motivo/origen son TEXTO LIBRE, sin CHECK — confirmado). motivo canónico:
--    'bounce' (bounce Permanent) | 'queja' (complaint). Transient/Undetermined/Delivery
--    NO suprimen (sólo estampan sent_emails para observabilidad y el freno de rebotes).
--  · email_bloqueado_total extiende su VÁLVULA (un cliente activo NO se hard-bloquea por un
--    rebote AUTOMÁTICO) de origen='webhook' a origen IN ('webhook','ses'): un rebote de
--    marketing SES a un cliente vivo NO le corta el transaccional (comprobantes/avisos).
--  · Aviso a gerencia SÓLO para rebotes/quejas de CLIENTES (administraciones activas) — el
--    RPC devuelve la lista y el edge avisa. El volumen de rebotes de prospectos/campañas
--    frías NO dispara avisos individuales (lección E-GG del ruido de las .invalid).
--
-- NO toca el harvester de Gmail (cron jobid 25): SES llega por su propio webhook push.

-- 1) Índice del lookup caliente del webhook (match evento SES ↔ envío). R11.
create index if not exists idx_sent_emails_provider_msg_id
  on public.sent_emails (provider_msg_id)
  where provider_msg_id is not null;

-- 2) Log de eventos de feedback de SES: trazabilidad (gate punto 7) + idempotencia
--    (dedup por SNS MessageId; SNS reentrega y puede llegar fuera de orden) + base de
--    métricas de entregabilidad (gate puntos 9/10). La ESCRIBE sólo el webhook
--    (service_role, bypassa RLS); el staff la LEE para observabilidad.
create table if not exists public.ses_feedback_events (
  id              uuid primary key default gen_random_uuid(),
  sns_message_id  text not null unique,
  tipo            text not null,            -- 'bounce' | 'complaint' | 'delivery' | 'other'
  subtipo         text,                     -- bounceType/bounceSubType | complaintFeedbackType
  es_permanente   boolean not null default false,
  email           text,                     -- primer destinatario (lower)
  emails          text[] not null default '{}',
  provider_msg_id text,                     -- mail.messageId (match sent_emails.provider_msg_id)
  feedback_id     text,                     -- bounce/complaint feedbackId de SES
  suprimidos      integer not null default 0,
  payload         jsonb not null,
  recibido_at     timestamptz not null default now()
);

alter table public.ses_feedback_events enable row level security;

revoke all on public.ses_feedback_events from anon;
grant select on public.ses_feedback_events to authenticated;

create policy ses_feedback_events_select_staff on public.ses_feedback_events
  for select using (private.is_staff());

create index if not exists idx_ses_feedback_events_recibido
  on public.ses_feedback_events (recibido_at desc);
create index if not exists idx_ses_feedback_events_email
  on public.ses_feedback_events (email) where email is not null;
create index if not exists idx_ses_feedback_events_tipo
  on public.ses_feedback_events (tipo, recibido_at desc);

comment on table public.ses_feedback_events is
  'DGG-268 F4: log de rebotes/quejas/entregas de Amazon SES recibidos por SNS→webhook (ses-event-webhook). Dedup por sns_message_id (idempotencia). Trazabilidad + base de métricas de entregabilidad.';

-- 3) RPC de ingesta (multi-tabla ⇒ R5). La llama el edge ses-event-webhook con
--    service_role DESPUÉS de verificar la firma SNS + TopicArn. Idempotente por
--    sns_message_id. Devuelve los clientes (administraciones activas) a avisar.
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
  -- (a) Idempotencia: dedup por SNS MessageId. Si ya lo procesamos, salir.
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
  v_event_type := case when p_tipo = 'complaint' then 'complained'
                       when p_tipo = 'bounce'    then 'bounced'
                       when p_tipo = 'delivery'  then 'delivered' end;

  -- (b) Estampar sent_emails por provider_msg_id (idempotente por (type,at)). Para TODO
  --     evento con event_type (incl. delivery). Alimenta el freno de rebotes LexPH, que
  --     lee sent_emails.estado/bounced_at/webhook_status.
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
      delivered_at  = case when v_event_type = 'delivered'  then coalesce(se.delivered_at,  p_event_at) else se.delivered_at end,
      bounced_at    = case when v_event_type = 'bounced'    then coalesce(se.bounced_at,    p_event_at) else se.bounced_at end,
      complained_at = case when v_event_type = 'complained' then coalesce(se.complained_at, p_event_at) else se.complained_at end,
      estado = case when v_event_type in ('bounced', 'complained') then v_event_type
                    when v_event_type = 'delivered' and se.estado = 'sent' then 'delivered'
                    else se.estado end,
      webhook_status = case when v_event_type = 'bounced'    then 'rebotado'
                            when v_event_type = 'complained' then 'queja'
                            when v_event_type = 'delivered'  then 'entregado'
                            else se.webhook_status end
    where se.provider_msg_id = p_provider_msg_id;
    get diagnostics v_stamped = row_count;
  end if;

  -- Transient / Undetermined / Delivery → no suprime. Sólo estampó.
  if not v_suppress then
    return jsonb_build_object('duplicate', false, 'suprimidos', 0, 'stamped', v_stamped,
                              'clientes', v_clientes, 'tipo', p_tipo);
  end if;

  -- (c) Suprimir globalmente cada destinatario + coherencia de entidad (R19).
  foreach v_email in array coalesce(p_emails, '{}'::text[]) loop
    v_norm := lower(btrim(coalesce(v_email, '')));
    continue when v_norm = '' or position('@' in v_norm) = 0;

    select id into v_prospecto from public.prospectos where email = v_norm;

    -- opt-out GLOBAL. No-downgrade: 'queja' siempre gana; un motivo YA-hard no se pisa; un
    -- motivo soft (baja_usuario/manual) se eleva a hard (rebote/queja). origen sigue al motivo.
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

    -- coherencia de panel (R19): bajar la entidad que corresponda.
    if v_prospecto is not null then
      update public.prospectos
         set estado_captacion = 'baja', baja_at = coalesce(baja_at, now()), updated_at = now()
       where id = v_prospecto;
    end if;
    update public.lexph_suscriptores
       set estado = 'baja', baja_at = coalesce(baja_at, now())
     where email_norm = v_norm and estado <> 'baja';

    -- cliente (administración) activo → marcar para aviso a gerencia (lo manda el edge).
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

revoke all on function public.ses_feedback_ingest(text,text,text,boolean,text[],text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.ses_feedback_ingest(text,text,text,boolean,text[],text,text,timestamptz,jsonb) to service_role;

comment on function public.ses_feedback_ingest(text,text,text,boolean,text[],text,text,timestamptz,jsonb) is
  'DGG-268 F4: ingesta idempotente (dedup sns_message_id) de rebotes/quejas/entregas de SES vía ses-event-webhook. Suprime (bounce Permanent / queja) en email_suppression (origen=ses, no-downgrade) + baja la entidad (prospecto/lexph) + estampa sent_emails. Devuelve clientes activos a avisar.';

-- 4) Extender la válvula de cliente activo a origen IN ('webhook','ses'). R16: MISMA firma
--    (p_email text) → CREATE OR REPLACE sin overload.
create or replace function public.email_bloqueado_total(p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select exists (
    select 1 from public.email_suppression s
    where s.email = lower(btrim(p_email))
      and s.motivo in ('bounce', 'queja', 'descartado_gerencia', 'invalida')
      and not (
        s.origen in ('webhook', 'ses')
        and exists (
          select 1 from public.administraciones a
          where lower(a.email) = s.email and a.estado <> 'baja'
        )
      )
  );
$fn$;

comment on function public.email_bloqueado_total(p_email text) is
  'Net HARD de supresión (lo leen dispatch-emails 2b-bis fail-open y el banner emails_rebotados_recientes). DGG-268 F4: la válvula que exime del hard-block a un cliente ACTIVO con rebote AUTOMÁTICO ahora cubre origen IN (webhook,ses) — un rebote de marketing SES no le corta el transaccional al cliente vivo (sí se le corta el marketing, vía email_esta_suprimido).';
