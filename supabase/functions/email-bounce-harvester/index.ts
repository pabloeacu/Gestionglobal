// D2-bis · email-bounce-harvester (v3 · DGG-117)
//
// v3 (2026-07-24, caso Nogueira):
//   · Matching multi-candidato: los rebotes de casillas con REDIRECCIÓN
//     reportan como fallida la dirección FINAL del reenvío (no la que
//     nosotros enviamos) → ahora se prueban en orden: "ultimately generated
//     from <addr>" del texto del DSN, original/final-recipient del
//     delivery-status, y la dirección del snippet.
//   · Aviso a gerencia: al marcar un bounce/complaint real se dispara
//     notify_all_gerentes (campanita + push + email con CTA a la ficha).
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
// Seguridad: verify_jwt = false; el gate real es CRON_SECRET en Authorization.
//
// v4 (§6 DGG-117, agentes A/C): gate "es un DSN" antes de marcar (evita
// falsos bounced por auto-replies de postmaster), 'complained' sólo por
// subject FBL (no por la palabra spam en el diagnóstico SMTP), anti-loop
// (rebotes de gerencia-notif-generica avisan sin email → corta el ciclo
// aviso→mail→rebote→aviso), e ilike con wildcards escapados.

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
  /** DGG-117 (v3): TODAS las direcciones del delivery-status, en orden
   *  original-recipient primero (la dirección a la que NOSOTROS enviamos)
   *  y final-recipient después (la dirección final tras redirecciones). */
  addresses: string[];
  action: string | null;
  statusCode: string | null;
  diagnostic: string | null;
}

function parseDeliveryStatus(text: string): BounceInfo {
  const out: BounceInfo = {
    recipient: null,
    addresses: [],
    action: null,
    statusCode: null,
    diagnostic: null,
  };
  const originals: string[] = [];
  const finals: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'original-recipient' || key === 'final-recipient') {
      // Formato: "rfc822; user@host" → quedamos con la dirección
      const addr = (val.split(';').pop()?.trim() ?? val).toLowerCase();
      if (addr.includes('@')) {
        (key === 'original-recipient' ? originals : finals).push(addr);
      }
      if (!out.recipient) out.recipient = addr;
    } else if (key === 'action' && !out.action) {
      out.action = val.toLowerCase();
    } else if (key === 'status' && !out.statusCode) {
      out.statusCode = val;
    } else if (key === 'diagnostic-code' && !out.diagnostic) {
      out.diagnostic = val.slice(0, 480);
    }
  }
  out.addresses = [...new Set([...originals, ...finals])];
  return out;
}

/** DGG-117 (v3): en rebotes de casillas con REDIRECCIÓN (caso Nogueira,
 *  E-GG-rebotes), el DSN reporta como fallida la dirección FINAL del reenvío
 *  (p.ej. un Gmail personal), que no existe en sent_emails. Pero el texto del
 *  DSN trae la original: "(ultimately generated from <addr>)". La extraemos
 *  como candidato de matching prioritario. */
function extractUltimatelyGenerated(text: string): string | null {
  const m = text.match(/ultimately generated from\s+<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
  return m ? m[1].toLowerCase() : null;
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
  administracion_id: string | null;
  template_slug: string | null;
  asunto: string | null;
}

async function findOriginalSentEmail(
  admin: ReturnType<typeof createClient>,
  recipient: string,
): Promise<SentEmailRow | null> {
  const { data, error } = await admin
    .from('sent_emails')
    .select('id, to_email, enviado_at, estado, administracion_id, template_slug, asunto')
    // §6 C#12: escapar % y _ para que un email con guión bajo no actúe de
    // comodín ilike y matchee un envío ajeno.
    .ilike('to_email', recipient.toLowerCase().replace(/([%_])/g, '\\$1'))
    .gte(
      'enviado_at',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .order('enviado_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as unknown as SentEmailRow;
}

/** DGG-117 (v3): probar candidatos en orden hasta matchear un envío nuestro.
 *  Orden: "ultimately generated from" (la dirección original de un forward) →
 *  original/final-recipient del delivery-status → dirección del snippet. */
async function findByCandidates(
  admin: ReturnType<typeof createClient>,
  candidates: string[],
): Promise<SentEmailRow | null> {
  for (const c of candidates) {
    if (!c || !c.includes('@')) continue;
    const sent = await findOriginalSentEmail(admin, c);
    if (sent) return sent;
  }
  return null;
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
        addresses: [],
        action: null,
        statusCode: null,
        diagnostic: null,
      };
      if (dsPart?.body?.data) {
        bounce = parseDeliveryStatus(base64UrlDecode(dsPart.body.data));
      }

      // DGG-117 (v3): candidatos de matching, en orden de confianza.
      // 1º la dirección ORIGINAL de un forward ("ultimately generated from"),
      // que es a la que nosotros enviamos; después las del delivery-status;
      // último recurso, la primera dirección del snippet.
      const plainPart = findPartByMime(msg.payload, 'text/plain');
      const plainText = plainPart?.body?.data
        ? base64UrlDecode(plainPart.body.data)
        : '';
      const candidates: string[] = [];
      const ultimately =
        extractUltimatelyGenerated(plainText) ??
        extractUltimatelyGenerated(msg.snippet ?? '');
      if (ultimately) candidates.push(ultimately);
      candidates.push(...bounce.addresses);
      const snippetAddr = (msg.snippet ?? '').match(
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
      );
      if (snippetAddr) candidates.push(snippetAddr[1].toLowerCase());
      const uniqueCandidates = [...new Set(candidates)];

      // §6 C#5 (v4): gate "esto ES un DSN". Un mail de postmaster que no sea
      // un reporte de entrega (auto-reply, aviso de cuarentena, digest) NO
      // debe marcar bounced: exigimos delivery-status, o la frase de forward,
      // o un subject inequívoco de DSN. Si no, se archiva sin tocar nada.
      const esDsn =
        !!dsPart ||
        !!ultimately ||
        /delivery status notification|undeliver|returned to sender|delivery incomplete|no se entreg/i.test(subjectTop);
      if (!esDsn) {
        processed++;
        await gmailMarkRead(accessToken, item.id);
        continue;
      }

      if (uniqueCandidates.length === 0) {
        // No pudimos identificar destinatario — saltar pero no error.
        processed++;
        await gmailMarkRead(accessToken, item.id);
        continue;
      }
      if (!bounce.recipient) bounce.recipient = uniqueCandidates[0];

      const sent = await findByCandidates(admin, uniqueCandidates);
      if (!sent) {
        processed++;
        await gmailMarkRead(accessToken, item.id);
        continue;
      }

      // Determinar estado a setear:
      // · action='failed' o status 5xx → bounced
      // · action='delayed' o status 4xx → delivery_delayed
      // · si subject FBL → complained
      let estado: 'bounced' | 'delivery_delayed' | 'complained' = 'bounced';
      // §6 C#6 (v4): 'complained' SOLO por subject de feedback-loop. La palabra
      // "spam" en el diagnóstico SMTP ("550 rejected as spam") es un rechazo
      // anti-spam del receptor = bounce, no una queja del usuario.
      const isComplaint = /complaint|abuse report|feedback-?loop/i.test(subjectTop);
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

      // DGG-117 (v3): avisar a gerencia (campanita + push + email) cuando un
      // envío REBOTA de verdad (no por demoras transitorias). Best-effort: un
      // fallo acá no aborta la cosecha. Idempotente por diseño: cada DSN se
      // procesa una sola vez (dsn_msg_id UNIQUE) → un solo aviso por rebote.
      if (estado === 'bounced' || estado === 'complained') {
        try {
          // §6 C#7 (v4) ANTI-LOOP: si lo que rebotó es un email interno a
          // gerencia (gerencia-notif-generica), avisar SOLO por campanita/push
          // (p_send_email=false). Si no, el ciclo aviso→mail a gerentes→rebote
          // del mail de un gerente→nuevo aviso→... se retroalimenta cada 30min.
          const esNotifInterna = sent.template_slug === 'gerencia-notif-generica';
          const url = sent.administracion_id
            ? `/gerencia/clientes/${sent.administracion_id}`
            : '/gerencia/configuracion/emails/cola';
          const titulo =
            estado === 'complained'
              ? `Queja de spam: ${sent.to_email}`
              : `Rebotó un email a ${sent.to_email}`;
          const cuerpo =
            `"${sent.asunto ?? sent.template_slug ?? 'email'}" no llegó a ${sent.to_email}. ` +
            `Motivo: ${(errMsg || 'desconocido').slice(0, 180)}. ` +
            `Verificá la casilla del cliente o corregí su mail de acceso desde la ficha.`;
          const { error: notifErr } = await admin.rpc('notify_all_gerentes', {
            p_evento_codigo: 'email_bounced',
            p_titulo: titulo,
            p_cuerpo: cuerpo,
            p_url: url,
            p_send_email: !esNotifInterna,
            p_related_table: 'sent_emails',
            p_related_id: sent.id,
          });
          if (notifErr) errors.push(`notif ${sent.id}: ${notifErr.message}`);
        } catch (e) {
          errors.push(`notif ${sent.id}: ${(e as Error).message}`);
        }
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
