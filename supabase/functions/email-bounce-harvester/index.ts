// D2-bis · email-bounce-harvester
//
// Lee la bandeja del alias `contacto@gestionglobal.ar` vía Gmail OAuth.
// Detecta DSNs (Delivery Status Notifications) que mailer-daemon envía
// cuando un email rebota, y actualiza `sent_emails.estado = 'bounced'`
// con el error real.
//
// Detección:
//   · q en Gmail: `from:mailer-daemon@googlemail.com OR from:postmaster@*
//     newer_than:7d -has:userlabels`
//   · O cualquier email con Content-Type: multipart/report
//
// Match con sent_emails:
//   · Original-Recipient (RFC 3464, dentro del part message/delivery-status)
//   · Fallback: to_email del DSN (texto plano "to: <addr>") matcheando con
//     sent_emails.to_email + enviado_at >= now - 7d
//
// Idempotencia:
//   · sent_emails.dsn_msg_id UNIQUE → si ya procesamos este DSN no lo
//     guardamos otra vez.
//
// Después de procesar:
//   · PATCH /messages/{id}/modify removeLabelIds=['UNREAD','INBOX'] para
//     que no aparezca de nuevo en próximas corridas (queda archivado).
//
// Cron: cada 30 minutos (mig 0154).
//
// Seguridad: verify_jwt = true; el cron pasa CRON_SECRET en Authorization.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;
const REFRESH_TOKEN =
  Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
  Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN') ??
  '';

const MAX_MESSAGES_PER_RUN = 50;

interface GmailListItem {
  id: string;
  threadId: string;
}
interface GmailMessageHeader {
  name: string;
  value: string;
}
interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailMessagePart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailMessagePart;
}

function base64UrlDecode(str: string): string {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const padded = s + '='.repeat(pad);
  try {
    return atob(padded);
  } catch {
    return '';
  }
}

async function refreshAccessToken(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`oauth refresh ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('access_token vacío');
  return j.access_token;
}

async function gmailList(accessToken: string, query: string): Promise<GmailListItem[]> {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(MAX_MESSAGES_PER_RUN));
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`gmail list ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = (await r.json()) as { messages?: GmailListItem[] };
  return j.messages ?? [];
}

async function gmailGetFull(accessToken: string, id: string): Promise<GmailMessage> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`gmail get ${r.status}: ${t.slice(0, 200)}`);
  }
  return (await r.json()) as GmailMessage;
}

async function gmailMarkRead(accessToken: string, id: string): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    },
  );
}

function findPartByMime(
  part: GmailMessagePart | undefined,
  mime: string,
): GmailMessagePart | null {
  if (!part) return null;
  if (part.mimeType === mime) return part;
  for (const p of part.parts ?? []) {
    const f = findPartByMime(p, mime);
    if (f) return f;
  }
  return null;
}

interface BounceInfo {
  recipient: string | null;
  action: string | null;
  statusCode: string | null;
  diagnostic: string | null;
}

function parseDeliveryStatus(text: string): BounceInfo {
  const out: BounceInfo = {
    recipient: null,
    action: null,
    statusCode: null,
    diagnostic: null,
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'original-recipient' || key === 'final-recipient') {
      // Formato: "rfc822; user@host" → quedamos con la dirección
      const addr = val.split(';').pop()?.trim() ?? val;
      if (!out.recipient) out.recipient = addr;
    } else if (key === 'action' && !out.action) {
      out.action = val.toLowerCase();
    } else if (key === 'status' && !out.statusCode) {
      out.statusCode = val;
    } else if (key === 'diagnostic-code' && !out.diagnostic) {
      out.diagnostic = val.slice(0, 480);
    }
  }
  return out;
}

function headersToMap(headers: GmailMessageHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

interface SentEmailRow {
  id: string;
  to_email: string;
  enviado_at: string;
  estado: string;
}

async function findOriginalSentEmail(
  admin: ReturnType<typeof createClient>,
  recipient: string,
): Promise<SentEmailRow | null> {
  const { data, error } = await admin
    .from('sent_emails')
    .select('id, to_email, enviado_at, estado')
    .ilike('to_email', recipient.toLowerCase())
    .gte(
      'enviado_at',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .order('enviado_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as SentEmailRow;
}

function nowIso(): string {
  return new Date().toISOString();
}

Deno.serve(async (req) => {
  // Authorization: el cron pasa Bearer CRON_SECRET. Si no coincide, 401.
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  if (!REFRESH_TOKEN) {
    return new Response(JSON.stringify({ error: 'oauth_missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'oauth_refresh', detail: (e as Error).message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Query a Gmail: mailer-daemon o postmaster + delivery status report.
  const q =
    'from:(mailer-daemon@* OR postmaster@*) newer_than:7d is:unread';
  let listed: GmailListItem[] = [];
  try {
    listed = await gmailList(accessToken, q);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'gmail_list', detail: (e as Error).message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let processed = 0;
  let matched = 0;
  let alreadyHad = 0;
  const errors: string[] = [];

  for (const item of listed) {
    try {
      // Idempotencia: si dsn_msg_id ya está en sent_emails, skip.
      const { data: existing } = await admin
        .from('sent_emails')
        .select('id')
        .eq('dsn_msg_id', item.id)
        .limit(1);
      if (existing && existing.length > 0) {
        alreadyHad++;
        continue;
      }

      const msg = await gmailGetFull(accessToken, item.id);

      // Buscar el part message/delivery-status.
      const dsPart = findPartByMime(msg.payload, 'message/delivery-status');
      const headersTop = headersToMap(msg.payload?.headers);
      const subjectTop = headersTop['subject'] ?? '';

      let bounce: BounceInfo = {
        recipient: null,
        action: null,
        statusCode: null,
        diagnostic: null,
      };
      if (dsPart?.body?.data) {
        bounce = parseDeliveryStatus(base64UrlDecode(dsPart.body.data));
      }
      // Fallback: parsear snippet o subject buscando "<addr>"
      if (!bounce.recipient) {
        const m = (msg.snippet ?? '').match(
          /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
        );
        if (m) bounce.recipient = m[1];
      }
      if (!bounce.recipient) {
        // No pudimos identificar destinatario — saltar pero no error.
        processed++;
        await gmailMarkRead(accessToken, item.id);
        continue;
      }

      const sent = await findOriginalSentEmail(admin, bounce.recipient);
      if (!sent) {
        processed++;
        await gmailMarkRead(accessToken, item.id);
        continue;
      }

      // Determinar estado a setear:
      // · action='failed' o status 5xx → bounced
      // · action='delayed' o status 4xx → delivery_delayed
      // · si "complaint" en subject → complained
      let estado: 'bounced' | 'delivery_delayed' | 'complained' = 'bounced';
      const isComplaint =
        /complaint|spam/i.test(subjectTop) ||
        /complaint|spam/i.test(bounce.diagnostic ?? '');
      if (isComplaint) estado = 'complained';
      else if (
        bounce.action === 'delayed' ||
        (bounce.statusCode && bounce.statusCode.startsWith('4'))
      ) {
        estado = 'delivery_delayed';
      }

      const errMsg = bounce.diagnostic
        ? `${bounce.statusCode ?? ''} ${bounce.diagnostic}`.trim()
        : (msg.snippet ?? '').slice(0, 400);

      const { error: updErr } = await admin
        .from('sent_emails')
        .update({
          estado,
          [`${estado === 'complained' ? 'complained_at' : estado === 'delivery_delayed' ? 'last_event_at' : 'bounced_at'}`]:
            nowIso(),
          last_event_at: nowIso(),
          dsn_msg_id: item.id,
          error_code: bounce.statusCode,
          error_msg: errMsg,
        })
        .eq('id', sent.id);

      if (updErr) {
        errors.push(`upd ${sent.id}: ${updErr.message}`);
        continue;
      }
      matched++;
      processed++;
      await gmailMarkRead(accessToken, item.id);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      listed: listed.length,
      processed,
      matched,
      already_had: alreadyHad,
      errors: errors.slice(0, 10),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
});
