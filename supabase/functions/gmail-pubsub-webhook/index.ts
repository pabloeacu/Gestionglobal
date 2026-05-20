// gmail-pubsub-webhook · stub para recibir notificaciones push de Gmail History
// API (delivered/bounced/opened). Por ahora dejamos el shape y un pasaje a
// public.apply_resend_event (el helper existente del 0006 que aplica eventos
// idempotente sobre sent_emails).
//
// TODO: Pub/Sub Gmail History — cablear Cloud Pub/Sub → este endpoint con
// el formato:
//   { message: { data: base64({ emailAddress, historyId }) } }
// Necesitamos `users.history.list` para mapear historyId → messageId → status.
// Hasta tener el wiring vivo, este endpoint:
//   1. responde 200 para no romper Pub/Sub
//   2. parsea el body y loggea
//   3. si recibe un payload directo (testing manual con curl) con
//      { provider_msg_id, event } actualiza sent_emails.webhook_status.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const STATUS_MAP: Record<string, string> = {
  delivered: 'entregado',
  opened: 'abierto',
  clicked: 'clickeado',
  bounced: 'rebotado',
  sent: 'enviado',
};

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('gmail-pubsub-webhook alive', { status: 200 });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: true, noted: 'empty body' });
  }

  // Caso 1 · Pub/Sub envelope { message: { data, attributes } }.
  if (body?.message?.data) {
    // TODO: decode + history.list via Gmail API. Por ahora ACK.
    console.log('[gmail-pubsub] ACK pub/sub envelope, historyId pending wiring');
    return json({ ok: true, ack: true });
  }

  // Caso 2 · payload directo para testing manual.
  const providerMsgId = body?.provider_msg_id as string | undefined;
  const event = body?.event as string | undefined;
  if (!providerMsgId || !event) return json({ ok: false, error: 'payload sin provider_msg_id / event' }, 400);

  const mapped = STATUS_MAP[event] ?? null;
  if (!mapped) return json({ ok: false, error: `event ${event} desconocido` }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { error } = await admin
    .from('sent_emails')
    .update({ webhook_status: mapped, last_event_at: new Date().toISOString() })
    .eq('provider_msg_id', providerMsgId);
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, updated: mapped });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
