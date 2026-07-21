// dispatch-emails · drena email_queue (kind=workflow), aplica throttle en dos
// pisos (DGG-113: 60s global entre destinatarios distintos + 5 min POR
// destinatario, la lección real de E42/D05) y envía vía Gmail API REST con
// OAuth2 refresh_token.
//
// Reuso del patrón de send-comprobante-email/index.ts: misma técnica para
// refresh access token + RFC 2047 + multipart MIME.
//
// IMPORTANTE (decisión del usuario 2026-05-26 v2): el Workspace tiene 4
// alias REALES, NO 1:
//   cursos@gestionglobal.ar                  (cursos y certificados)
//   consultoriajuridica@gestionglobal.ar     (consultas jurídicas)
//   contacto@gestionglobal.ar                (todo lo demás — default; incl. EVENTOS
//                                             desde 2026-07-09, Pablo · DGG-100)
// NO existen: info@, facturacion@, tramites@, recupero@ (eran fake).
// Cualquier email enviado FROM un alias inexistente se descarta silenciosamente
// (Gmail acepta en API pero no entrega). Por eso se mapea casilla → alias
// real vía `aliasFor()` más abajo.
//
// Layout MANAXER (2026-05-26 v3): cuando `layout_version = 'manaxer-v1'`,
// el HTML final se construye desde los campos visuales (kicker, titulo_visual,
// color_acento, mostrar_logo, cuerpo_html_visual, firma, cta_text, cta_url,
// incluir_tabla_envio). En caso contrario se usa el legacy `body_html`.
//
// Secrets requeridos:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN  (refresh_token para contacto@)
//   (También sirve GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT con la misma idea.)
//
// Trigger: pg_cron */1 min via net.http_post con Bearer service_role.
// Idempotente: si no hay nada que enviar, devuelve {drained:0}.
// verify_jwt = false: la auth es CRON_SECRET/service_role validado ADENTRO
// (AUDIT-011) — con verify_jwt=true la plataforma rechaza el bearer del cron
// con 401 ANTES de llegar al código (lección del redeploy DGG-113).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const DOMAIN = 'gestionglobal.ar';
const CONTACTO = `contacto@${DOMAIN}`;
const LOGO_URL = `https://www.${DOMAIN}/logo-color.png`;

// Mapeo casilla (metadata semántica del template) → alias REAL.
// Casillas no listadas caen al default (contacto@).
// 2026-07-09 (Pablo · DGG-100): 'webinar'/'evento' YA NO mapean a webinar@ —
// caen al default (contacto@, la principal). webinar@ daba problemas de entrega
// como "send-as"; los eventos se envían desde contacto@ (templates repuntados a
// 'general' en mig 0301; casos acá por defensa si quedara metadata vieja).
function aliasFor(casilla: string | null | undefined): string {
  switch (casilla) {
    case 'cursos':
      return `cursos@${DOMAIN}`;
    case 'juridico':
    case 'consultoria':
    case 'consultoria_juridica':
      return `consultoriajuridica@${DOMAIN}`;
    default:
      return CONTACTO;
  }
}

const THROTTLE_KEY = 'global';
// DGG-113 (2026-07-21, decisión Pablo): el throttle se separa en dos pisos.
// La lección real de E42 fue una RÁFAGA AL MISMO CLIENTE (4 mails en 30s):
// ese piso de 5 min POR DESTINATARIO se conserva intacto (RECIPIENT_FLOOR_MS).
// El ritmo GLOBAL entre mails de destinatarios distintos baja a 60s — sigue
// siendo humilde para Gmail API (cupo Workspace: 2.000/día por casilla; acá
// máx. 1.440/día teóricos) y elimina las esperas prácticas (password-reset
// detrás de una cola, recordatorios de encuentros con N alumnos).
const THROTTLE_MS = 60 * 1000;
const RECIPIENT_FLOOR_MS = 5 * 60 * 1000;
const BATCH_MAX = 1;
// Candidatos a examinar por corrida: si el primero está bloqueado por el piso
// por-destinatario, se intenta con los siguientes (sin saltear prioridades
// entre destinatarios distintos: el orden prioridad/programado_para se respeta).
const CANDIDATE_MAX = 10;

type Casilla = string;

interface TemplateRow {
  slug: string;
  asunto: string;
  body_html: string;
  body_text: string | null;
  from_casilla: Casilla;
  reply_to: string | null;
  // MANAXER layout fields
  kicker: string;
  titulo_visual: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html_visual: string;
  firma: string | null;
  incluir_tabla_envio: boolean;
  cta_text: string | null;
  cta_url: string | null;
  layout_version: string;
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
  if (req.method === 'GET') return new Response('dispatch-emails alive', { status: 200 });

  // AUDIT-011: Auth — exigimos CRON_SECRET o service_role en Bearer.
  // Sin esto, cualquier IP podía triggear el dispatch (DoS/bypass throttle).
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (authHeader !== serviceKey && (!cronSecret || authHeader !== cronSecret)) {
    return jsonError(401, 'unauthorized');
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  // 1) Throttle GLOBAL (ritmo entre mails de destinatarios distintos — DGG-113).
  const { data: throttleRow } = await admin
    .from('email_throttle').select('last_sent_at').eq('key', THROTTLE_KEY).maybeSingle();
  if (throttleRow?.last_sent_at) {
    const delta = Date.now() - new Date(throttleRow.last_sent_at).getTime();
    if (delta < THROTTLE_MS) {
      return json({ ok: true, throttled: true, wait_ms: THROTTLE_MS - delta });
    }
  }

  // 2) Próximos jobs (candidatos en orden de prioridad).
  const { data: rows, error: errQueue } = await admin
    .from('email_queue')
    .select('id, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, administracion_id, consorcio_id')
    .eq('kind', 'workflow')
    .is('enviado_at', null)
    .lte('programado_para', new Date().toISOString())
    .order('prioridad', { ascending: true })
    .order('programado_para', { ascending: true })
    .limit(CANDIDATE_MAX);
  if (errQueue) return jsonError(500, `queue read: ${errQueue.message}`);
  if (!rows || rows.length === 0) return json({ ok: true, drained: 0 });

  // 2b) Piso POR DESTINATARIO (la lección original de E42: jamás 2 mails al
  // mismo email en <5 min). Se toma el primer candidato cuyo destinatario no
  // recibió nada en la ventana; los bloqueados quedan en cola y se reintentan
  // en la próxima corrida (el cron pasa cada 1 min). Si todos están bloqueados,
  // esta corrida no envía — igual que un tick throttled de siempre.
  const recipientCutoff = new Date(Date.now() - RECIPIENT_FLOOR_MS).toISOString();
  let job: QueueRow | null = null;
  for (const candidate of rows as QueueRow[]) {
    const { count, error: errRecent } = await admin
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('to_email', candidate.to_email)
      .eq('status', 'sent')
      .gte('sent_at', recipientCutoff);
    // Ante un error de lectura, preferimos NO enviar (fail-closed del piso).
    if (errRecent) return jsonError(500, `recipient check: ${errRecent.message}`);
    if (!count) {
      job = candidate;
      break;
    }
  }
  if (!job) {
    return json({ ok: true, drained: 0, recipient_throttled: true });
  }

  // 3) Cargar template (con campos MANAXER).
  const { data: tplRow, error: errTpl } = await admin
    .from('email_templates')
    .select(`
      slug, asunto, body_html, body_text, from_casilla, reply_to,
      kicker, titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual,
      firma, incluir_tabla_envio, cta_text, cta_url, layout_version
    `)
    .eq('slug', job.template_slug)
    .eq('activo', true)
    .maybeSingle();
  if (errTpl || !tplRow) {
    await failJob(admin, job, `Template ${job.template_slug} no encontrado o inactivo`);
    return json({ ok: false, drained: 0, error: 'template-missing' });
  }
  const tpl = tplRow as TemplateRow;

  // 4) Resolver alias real para From / Reply-To.
  const casilla = tpl.from_casilla;
  const senderEmail = aliasFor(casilla);
  const replyToEmail = senderEmail;
  const refreshToken =
    Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
    Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');

  if (!clientId || !clientSecret || !refreshToken) {
    await failJob(admin, job, `OAuth no configurado`);
    return jsonError(500, 'oauth missing');
  }

  // 5) Render del subject + html usando layout MANAXER o legacy.
  const vars = (job.variables ?? {}) as Record<string, unknown>;
  const subject = renderVars(tpl.asunto, vars);
  let html: string;
  if (tpl.layout_version === 'manaxer-v1') {
    html = buildManaxerHtml(tpl, vars, senderEmail, replyToEmail);
    // Hardening (E-GG-74): una plantilla manaxer-v1 con `cuerpo_html_visual` vacío
    // produce un mail "sólo logo" (el dispatcher no mira `body_html` en este layout).
    // Defensa: si el cuerpo visual renderiza vacío y existe `body_html` legacy,
    // caemos al render legacy completo (body_html es un documento HTML entero, por
    // eso NO se inyecta dentro del layout manaxer → se reemplaza todo el html).
    // Las plantillas manaxer con cuerpo poblado (las ~35 vigentes) no se tocan.
    const cuerpoVacio = !renderVars(tpl.cuerpo_html_visual ?? '', vars).trim();
    if (cuerpoVacio && (tpl.body_html ?? '').trim()) {
      html = renderVars(tpl.body_html, vars);
    }
  } else {
    html = renderVars(tpl.body_html, vars);
  }
  // E-GG-79: body_text es texto PLANO → no debe HTML-escaparse (rompería URLs).
  const text = tpl.body_text ? renderVarsRaw(tpl.body_text, vars) : undefined;

  // 6) OAuth2 access token.
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    await failJob(admin, job, `OAuth refresh: ${(e as Error).message}`);
    return jsonError(502, 'oauth refresh failed');
  }

  // 7) MIME + Gmail send.
  const fromHeader = `${encodeRfc2047('Gestión Global')} <${senderEmail}>`;
  const mime = buildMimeMessage({
    from: fromHeader,
    to: [job.to_email],
    replyTo: replyToEmail,
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
  // E-GG-108: además de enviado_at (marca real que usa el dispatcher para no
  // reprocesar), avanzar status a 'sent' + sent_at. Es higiene de reporting: sin
  // esto el email ENTREGADO quedaba 'pending' para siempre (101 filas). NO era
  // la causa del banner que vio JL — el health check keyea enviado_at, no status;
  // el banner era un falso positivo del throttle (se arregló reescribiendo el
  // check). Esto mantiene status coherente para EmailQueuePage / cancelaciones.
  const nowIso = new Date().toISOString();
  await admin.from('email_queue').update({
    enviado_at: nowIso,
    sent_at: nowIso,
    status: 'sent',
    ultimo_error: null,
  }).eq('id', job.id);

  await admin.from('sent_emails').insert({
    to_email: job.to_email,
    from_email: senderEmail,
    from_casilla: casilla,
    reply_to: replyToEmail,
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

// =========================================================================
// MANAXER layout — armado del HTML completo desde los campos visuales
// =========================================================================
function buildManaxerHtml(
  tpl: TemplateRow,
  vars: Record<string, unknown>,
  fromEmail: string,
  replyToEmail: string,
): string {
  const accent = sanitizeHex(tpl.color_acento) ?? '#0891b2';
  const kicker = renderVars(tpl.kicker, vars);
  const titulo = renderVars(tpl.titulo_visual, vars);
  const cuerpo = renderVars(tpl.cuerpo_html_visual, vars);
  const firma = tpl.firma ? renderVars(tpl.firma, vars) : null;
  const ctaText = tpl.cta_text ? renderVars(tpl.cta_text, vars) : null;
  // E-GG-79: la URL va a un href → escapar UNA sola vez (escapeAttr abajo).
  // renderVars la escaparía primero → doble-escape que rompe query params.
  const ctaUrl = tpl.cta_url ? renderVarsRaw(tpl.cta_url, vars) : null;
  const hasCta = !!(ctaText && ctaUrl);

  const logoBlock = tpl.mostrar_logo
    ? `<tr><td align="center" style="padding:32px 24px 12px 24px;">
        <img src="${LOGO_URL}" alt="Gestión Global"
             style="display:block;max-width:220px;height:auto;margin:0 auto;" />
      </td></tr>`
    : '';

  const kickerBlock = kicker
    ? `<tr><td style="padding:24px 32px 4px 32px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${accent};">${escapeAttr(kicker)}</p>
      </td></tr>`
    : '';

  const tituloBlock = titulo
    ? `<tr><td style="padding:0 32px 8px 32px;">
        <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:28px;line-height:1.18;font-weight:800;color:#0f172a;">${escapeAttr(titulo)}</h1>
      </td></tr>`
    : '';

  const separator = `<tr><td style="padding:16px 32px 0 32px;">
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" />
    </td></tr>`;

  const cuerpoBlock = `<tr><td style="padding:20px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#1e293b;">${cuerpo}</td></tr>`;

  const ctaBlock = hasCta
    ? `<tr><td style="padding:8px 32px 24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-radius:10px;background-color:${accent};">
            <a href="${escapeAttr(ctaUrl!)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeAttr(ctaText!)}
            </a>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  const firmaBlock = firma
    ? `<tr><td style="padding:12px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#64748b;">${escapeAttr(firma)}</td></tr>`
    : '';

  const tablaEnvio = tpl.incluir_tabla_envio
    ? `<tr><td style="padding:0 32px 16px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:collapse;background:#f8fafc;border-radius:10px;">
          <tr>
            <td style="padding:10px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#475569;">
              <strong style="color:#0f172a;">FROM</strong> ${escapeAttr(fromEmail)} ·
              <strong style="color:#0f172a;">REPLY-TO</strong> ${escapeAttr(replyToEmail)}
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  const footerBlock = `<tr><td style="padding:18px 32px 28px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
        Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.${DOMAIN}" style="color:${accent};text-decoration:none;">${DOMAIN}</a>
      </p>
    </td></tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeAttr(titulo || 'Gestión Global')}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
      ${logoBlock}
      ${kickerBlock}
      ${tituloBlock}
      ${separator}
      ${cuerpoBlock}
      ${ctaBlock}
      ${firmaBlock}
      ${tablaEnvio}
      ${footerBlock}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeHex(s: string | null | undefined): string | null {
  if (!s) return null;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

// =========================================================================
// Helpers existentes (sin cambios)
// =========================================================================

async function failJob(admin: ReturnType<typeof createClient>, job: QueueRow, msg: string) {
  const nextIntento = (job.intento ?? 0) + 1;
  const exhausted = nextIntento >= job.max_intentos;
  const backoffMin = Math.min(Math.pow(2, nextIntento), 60);
  const nextSchedule = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

  if (exhausted) {
    // E-GG-108: además de enviado_at (stop marker), avanzar status a 'failed'
    // para que no quede 'pending' contando como "atascado" tras agotar reintentos.
    await admin.from('email_queue').update({
      intento: nextIntento,
      ultimo_error: msg,
      enviado_at: new Date().toISOString(),
      status: 'failed',
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

// E-GG-79 (DGG-93 §6) · Sustitución SIN escapar HTML. Para valores que después
// pasan por otro escape (href → escapeAttr) o que son texto plano (body_text):
// escapar acá + escapeAttr = doble-escape (`&` → `&amp;amp;`) que ROMPE las URLs
// con query params (p. ej. el link de recovery ?token=..&type=recovery&redirect_to=..
// perdía sus separadores). El caller es responsable del escape del contexto final.
function renderVarsRaw(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v === null || v === undefined ? '' : String(v);
  });
}

function escapeHtmlIfNeeded(s: string): string {
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
  headers.push('X-Auto-Response-Suppress: All');
  headers.push('X-Mailer: Gestion Global Platform');

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
