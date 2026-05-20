// send-comprobante-email · Gmail API REST con OAuth2 refresh_token.
//
// Secrets requeridos:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN  (obtenido via oauth-callback la 1ª vez)
//   GOOGLE_OAUTH_SENDER_EMAIL   (e.g. facturacion@gestionglobal.ar)
//   WORKSPACE_FROM_NAME         (e.g. Gestión Global)
//   WORKSPACE_REPLY_TO          (opcional)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendPayload {
  comprobante_id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string;
  pdf_base64?: string;
  pdf_filename?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  let payload: SendPayload;
  try { payload = await req.json(); } catch { return jsonError(400, 'JSON invalido'); }
  if (!payload.comprobante_id) return jsonError(400, 'comprobante_id requerido');
  if (!payload.to || payload.to.length === 0) return jsonError(400, 'al menos un destinatario');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError(401, 'falta Authorization header');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: comp, error: errComp } = await supabase
    .from('comprobantes')
    .select('id, tipo, punto_venta, numero, fecha, vencimiento, total, receptor_razon_social, receptor_numero_documento, administracion_id, consorcio_id, observaciones')
    .eq('id', payload.comprobante_id)
    .single();
  if (errComp || !comp) return jsonError(404, 'comprobante no encontrado o sin acceso');

  const numStr = comp.numero
    ? `${String(comp.punto_venta).padStart(5, '0')}-${String(comp.numero).padStart(8, '0')}`
    : 'SIN NUMERO';
  const subject = payload.subject ?? `Comprobante ${comp.tipo} ${numStr} · Gestión Global`;
  const html = payload.html ?? defaultEmailHtml(comp, numStr);

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
  const senderEmail = Deno.env.get('GOOGLE_OAUTH_SENDER_EMAIL');
  const fromName = Deno.env.get('WORKSPACE_FROM_NAME') ?? 'Gestion Global';
  const replyTo = Deno.env.get('WORKSPACE_REPLY_TO') ?? senderEmail;

  if (!clientId || !clientSecret || !refreshToken || !senderEmail) {
    return jsonError(500, 'OAuth2 no configurado: faltan GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / SENDER_EMAIL');
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    return jsonError(502, `OAuth refresh fallo: ${(e as Error).message}`);
  }

  // Codificar el display name del From con RFC 2047 si tiene UTF-8 (Gestión).
  const fromHeader = `${encodeRfc2047(fromName)} <${senderEmail}>`;

  const mime = buildMimeMessage({
    from: fromHeader,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    replyTo: replyTo ?? undefined,
    subject,
    html,
    attachment: payload.pdf_base64
      ? { filename: payload.pdf_filename ?? `comprobante-${numStr}.pdf`, base64: payload.pdf_base64, mimeType: 'application/pdf' }
      : undefined,
  });
  const raw = base64UrlEncode(mime);

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
      return jsonError(502, `Gmail API ${r.status}: ${txt}`);
    }
  } catch (e) {
    return jsonError(502, `Gmail API error: ${(e as Error).message}`);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: logged } = await admin
    .from('sent_emails')
    .insert({
      to_email: payload.to[0]!,
      cc: payload.cc?.join(', ') ?? null,
      from_email: senderEmail,
      reply_to: replyTo,
      asunto: subject,
      plantilla: 'comprobante_default',
      html,
      attachments_meta: payload.pdf_base64 ? [{ filename: payload.pdf_filename ?? `comprobante-${numStr}.pdf`, kind: 'pdf' }] : null,
      estado: 'sent',
      comprobante_id: comp.id,
      administracion_id: comp.administracion_id,
      consorcio_id: comp.consorcio_id,
      zip_attached: false,
    })
    .select('id')
    .single();

  await admin
    .from('comprobantes')
    .update({ email_enviado_at: new Date().toISOString(), email_envios_count: 1 })
    .eq('id', comp.id);

  return new Response(JSON.stringify({ ok: true, sent_email_id: logged?.id ?? null, to: payload.to, subject }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

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
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachment?: { filename: string; base64: string; mimeType: string };
}

function buildMimeMessage(a: MimeArgs): string {
  const boundary = `bound_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const headers: string[] = [
    `From: ${a.from}`,
    `To: ${a.to.join(', ')}`,
  ];
  if (a.cc && a.cc.length > 0) headers.push(`Cc: ${a.cc.join(', ')}`);
  if (a.bcc && a.bcc.length > 0) headers.push(`Bcc: ${a.bcc.join(', ')}`);
  if (a.replyTo) headers.push(`Reply-To: ${a.replyTo}`);
  headers.push(`Subject: ${encodeRfc2047(a.subject)}`);
  headers.push('MIME-Version: 1.0');

  if (a.attachment) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts: string[] = [
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(a.html)))),
      `--${boundary}`,
      `Content-Type: ${a.attachment.mimeType}; name="${a.attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.attachment.filename}"`,
      '',
      chunkBase64(a.attachment.base64),
      `--${boundary}--`,
    ];
    return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
  }

  headers.push('Content-Type: text/html; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: base64');
  return headers.join('\r\n') + '\r\n\r\n' + chunkBase64(btoa(unescape(encodeURIComponent(a.html))));
}

// RFC 2047: si el string tiene caracteres no ASCII, lo encodea como
// =?UTF-8?B?...?=. Si es ASCII puro, lo devuelve tal cual.
// Usado para el display name del From y el Subject del email.
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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function defaultEmailHtml(
  comp: { tipo: string; fecha: string; vencimiento: string | null; total: number | string | null; receptor_razon_social: string; observaciones: string | null },
  numStr: string,
): string {
  const total = Number(comp.total ?? 0);
  const totalFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(total);
  const parseLocal = (d: string) => { const p = d.split('-').map(Number); return new Date(p[0]!, p[1]!-1, p[2]!); };
  const fechaFmt = parseLocal(comp.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const vencFmt = comp.vencimiento ? parseLocal(comp.vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Comprobante ${comp.tipo} ${numStr}</title></head><body style="margin:0;background:#f8fafc;font-family:Inter,Helvetica,Arial,sans-serif;color:#0d1e2f;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -10px rgba(15,23,42,0.18);"><div style="background:linear-gradient(135deg,#009eca 0%,#16a0a2 100%);padding:32px 28px;color:#fff;"><p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">Gestión Global</p><h1 style="margin:6px 0 0;font-size:24px;font-weight:800;">Comprobante ${comp.tipo} ${numStr}</h1></div><div style="padding:28px;"><p style="margin:0 0 10px;font-size:14px;line-height:1.55;">Hola <strong>${escapeHtml(comp.receptor_razon_social)}</strong>,</p><p style="margin:0 0 18px;font-size:14px;line-height:1.55;">Te enviamos el comprobante correspondiente al servicio detallado a continuación. Adjuntamos el PDF para tu registro.</p><div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:18px;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><td style="padding:6px 0;color:#64748b;">Fecha de emisión</td><td style="padding:6px 0;text-align:right;font-weight:600;">${fechaFmt}</td></tr>${vencFmt ? `<tr><td style="padding:6px 0;color:#64748b;">Vencimiento</td><td style="padding:6px 0;text-align:right;font-weight:600;">${vencFmt}</td></tr>` : ''}<tr style="border-top:2px solid #009eca;"><td style="padding:12px 0 4px;color:#009eca;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.08em;">Total</td><td style="padding:12px 0 4px;text-align:right;color:#009eca;font-weight:800;font-size:20px;">${totalFmt}</td></tr></table></div>${comp.observaciones ? `<p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.55;background:#f8fafc;padding:12px 14px;border-radius:8px;">${escapeHtml(comp.observaciones)}</p>` : ''}<p style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#475569;">Si tenés alguna consulta, podés responder este email.</p><p style="margin:0;font-size:13px;line-height:1.55;color:#475569;">Saludos,<br/><strong>Gestión Global</strong></p></div><div style="background:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">Gestión Global · gestionglobal.ar · Aliados de tu tiempo</div></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
