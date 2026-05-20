// dispatch-emails · drena email_queue (kind=workflow), aplica throttle global
// hard 5 min (E42/D05) y envía vía Gmail API REST con OAuth2 refresh_token.
//
// Reuso del patrón de send-comprobante-email/index.ts: misma técnica para
// refresh access token + RFC 2047 + multipart MIME.
//
// Secrets requeridos:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   Por casilla (al menos una; si falta una, los emails de esa casilla
//   se reagendan con error explícito):
//     GMAIL_OAUTH_REFRESH_TOKEN_INFO         info@gestionglobal.ar
//     GMAIL_OAUTH_REFRESH_TOKEN_CURSOS       cursos@gestionglobal.ar
//     GMAIL_OAUTH_REFRESH_TOKEN_FACTURACION  facturacion@gestionglobal.ar
//     GMAIL_OAUTH_REFRESH_TOKEN_TRAMITES     tramites@gestionglobal.ar
//     GMAIL_OAUTH_REFRESH_TOKEN_RECUPERO     recupero@gestionglobal.ar
//   Fallback: GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT (refresh_token único,
//   delegado por Workspace para enviar como cualquier casilla del dominio).
//
// Trigger: pg_cron */1 min via net.http_post con Bearer service_role.
// Idempotente: si no hay nada que enviar, devuelve {drained:0}.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const CASILLA_DOMAIN = 'gestionglobal.ar';
const THROTTLE_KEY = 'global';
const THROTTLE_MS = 5 * 60 * 1000; // 5 min hard (E42/D05)
const BATCH_MAX = 1; // por cada tick mandamos UN email (throttle global)

type Casilla = 'info' | 'cursos' | 'facturacion' | 'tramites' | 'recupero';

interface TemplateRow {
  slug: string;
  asunto: string;
  body_html: string;
  body_text: string | null;
  from_casilla: Casilla;
  reply_to: string | null;
}

interface QueueRow {
  id: string;
  template_slug: string;
  to_email: string;
  to_nombre: string | null;
  variables: Record<string, unknown>;
  prioridad: number;
  intento: number;
  max_intentos: number;
  administracion_id: string | null;
  consorcio_id: string | null;
}

Deno.serve(async (req) => {
  // Permitir GET para health-check manual.
  if (req.method === 'GET') return new Response('dispatch-emails alive', { status: 200 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Throttle global hard 5 min.
  const { data: throttleRow } = await admin
    .from('email_throttle').select('last_sent_at').eq('key', THROTTLE_KEY).maybeSingle();
  if (throttleRow?.last_sent_at) {
    const delta = Date.now() - new Date(throttleRow.last_sent_at).getTime();
    if (delta < THROTTLE_MS) {
      return json({ ok: true, throttled: true, wait_ms: THROTTLE_MS - delta });
    }
  }

  // 2) Próximos jobs (prioridad ASC, programado_para ASC).
  const { data: rows, error: errQueue } = await admin
    .from('email_queue')
    .select('id, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, administracion_id, consorcio_id')
    .eq('kind', 'workflow')
    .is('enviado_at', null)
    .lte('programado_para', new Date().toISOString())
    .order('prioridad', { ascending: true })
    .order('programado_para', { ascending: true })
    .limit(BATCH_MAX);
  if (errQueue) return jsonError(500, `queue read: ${errQueue.message}`);
  if (!rows || rows.length === 0) return json({ ok: true, drained: 0 });

  const job = rows[0] as QueueRow;

  // 3) Cargar template.
  const { data: tplRow, error: errTpl } = await admin
    .from('email_templates')
    .select('slug, asunto, body_html, body_text, from_casilla, reply_to')
    .eq('slug', job.template_slug)
    .eq('activo', true)
    .maybeSingle();
  if (errTpl || !tplRow) {
    await failJob(admin, job, `Template ${job.template_slug} no encontrado o inactivo`);
    return json({ ok: false, drained: 0, error: 'template-missing' });
  }
  const tpl = tplRow as TemplateRow;

  // 4) Resolver casilla → refresh_token + sender email.
  const casilla = tpl.from_casilla;
  const senderEmail = `${casilla}@${CASILLA_DOMAIN}`;
  const envName = `GMAIL_OAUTH_REFRESH_TOKEN_${casilla.toUpperCase()}`;
  const refreshToken =
    Deno.env.get(envName) ??
    Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
    Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN'); // compat con send-comprobante-email
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');

  if (!clientId || !clientSecret || !refreshToken) {
    await failJob(admin, job, `OAuth no configurado para casilla ${casilla} (env ${envName} faltante)`);
    return jsonError(500, `oauth missing for ${casilla}`);
  }

  // 5) Render del subject/html/text con {{var}}.
  const vars = (job.variables ?? {}) as Record<string, unknown>;
  const subject = renderVars(tpl.asunto, vars);
  const html = renderVars(tpl.body_html, vars);
  const text = tpl.body_text ? renderVars(tpl.body_text, vars) : undefined;

  // 6) OAuth2 → access token.
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    await failJob(admin, job, `OAuth refresh: ${(e as Error).message}`);
    return jsonError(502, 'oauth refresh failed');
  }

  // 7) MIME + Gmail API.
  const fromHeader = `${encodeRfc2047('Gestión Global')} <${senderEmail}>`;
  const mime = buildMimeMessage({
    from: fromHeader,
    to: [job.to_email],
    replyTo: tpl.reply_to ?? senderEmail,
    subject,
    html,
    text,
  });
  const raw = base64UrlEncode(mime);

  let providerMsgId: string | null = null;
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    if (!r.ok) {
      const txt = await r.text();
      await failJob(admin, job, `Gmail ${r.status}: ${txt.slice(0, 500)}`);
      return jsonError(502, `gmail ${r.status}`);
    }
    const j = await r.json() as { id?: string };
    providerMsgId = j.id ?? null;
  } catch (e) {
    await failJob(admin, job, `Gmail error: ${(e as Error).message}`);
    return jsonError(502, 'gmail error');
  }

  // 8) Marcar enviado + sent_emails + throttle.
  const nowIso = new Date().toISOString();
  await admin.from('email_queue').update({
    enviado_at: nowIso,
    ultimo_error: null,
  }).eq('id', job.id);

  await admin.from('sent_emails').insert({
    to_email: job.to_email,
    from_email: senderEmail,
    from_casilla: casilla,
    reply_to: tpl.reply_to ?? senderEmail,
    asunto: subject,
    plantilla: tpl.slug,
    template_slug: tpl.slug,
    html,
    estado: 'sent',
    webhook_status: 'enviado',
    provider_msg_id: providerMsgId,
    administracion_id: job.administracion_id,
    consorcio_id: job.consorcio_id,
    zip_attached: false,
  });

  await admin.from('email_throttle').upsert({
    key: THROTTLE_KEY,
    last_sent_at: nowIso,
    updated_at: nowIso,
  });

  return json({ ok: true, drained: 1, sent_id: job.id, provider_msg_id: providerMsgId });
});

async function failJob(admin: ReturnType<typeof createClient>, job: QueueRow, msg: string) {
  const nextIntento = (job.intento ?? 0) + 1;
  const exhausted = nextIntento >= job.max_intentos;
  // backoff exponencial: 2^intento minutos (1, 2, 4, 8, 16, ...).
  const backoffMin = Math.min(Math.pow(2, nextIntento), 60);
  const nextSchedule = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

  if (exhausted) {
    await admin.from('email_queue').update({
      intento: nextIntento,
      ultimo_error: msg,
      enviado_at: new Date().toISOString(), // marca cierre con error
    }).eq('id', job.id);
  } else {
    await admin.from('email_queue').update({
      intento: nextIntento,
      ultimo_error: msg,
      programado_para: nextSchedule,
    }).eq('id', job.id);
  }
}

function renderVars(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    if (v === null || v === undefined) return '';
    return escapeHtmlIfNeeded(String(v));
  });
}

function escapeHtmlIfNeeded(s: string): string {
  // No re-escapamos el HTML del template; sólo los valores de variables.
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`token endpoint ${r.status}: ${txt}`);
  }
  const j = await r.json() as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(`sin access_token (${j.error ?? 'desconocido'})`);
  return j.access_token;
}

interface MimeArgs {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
}

function buildMimeMessage(a: MimeArgs): string {
  const boundary = `bound_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const hasText = !!a.text;
  const headers: string[] = [
    `From: ${a.from}`,
    `To: ${a.to.join(', ')}`,
  ];
  if (a.replyTo) headers.push(`Reply-To: ${a.replyTo}`);
  headers.push(`Subject: ${encodeRfc2047(a.subject)}`);
  headers.push('MIME-Version: 1.0');

  if (hasText) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts: string[] = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(a.text!)))),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(a.html)))),
      `--${boundary}--`,
    ];
    return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
  }

  headers.push('Content-Type: text/html; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: base64');
  return headers.join('\r\n') + '\r\n\r\n' + chunkBase64(btoa(unescape(encodeURIComponent(a.html))));
}

function encodeRfc2047(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
