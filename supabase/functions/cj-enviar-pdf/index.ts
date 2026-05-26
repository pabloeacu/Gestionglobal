// cj-enviar-pdf · envía un documento CJ por email con el PDF como attachment.
//
// Flow:
//   1. Cliente del frontend ya generó el PDF y lo subió al bucket cj-documentos
//   2. Frontend invoca esta edge con { doc_id }
//   3. Edge lee cj_documentos, descarga el PDF de storage, arma MIME multipart
//      con el attachment, envía via Gmail API (OAuth refresh) y registra
//      en sent_emails + cj_documento_marcar_enviado.
//
// Reutiliza el OAuth refresh_token de contacto@ (ya configurado para
// dispatch-emails). Sender = consultoriajuridica@gestionglobal.ar (alias real).
//
// Citas: regla 7 (edge fn versionada), reuso del patrón dispatch-emails.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const DOMAIN = 'gestionglobal.ar';
const FROM = `consultoriajuridica@${DOMAIN}`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { doc_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const docId = body.doc_id;
  if (!docId) return jsonError(400, 'doc_id requerido');

  // 1) Cargar documento
  const { data: doc, error: errDoc } = await admin
    .from('cj_documentos')
    .select('id, tema, titulo, destinatario_nombre, destinatario_email, pdf_storage_path')
    .eq('id', docId)
    .maybeSingle();
  if (errDoc || !doc) return jsonError(404, 'documento no encontrado');
  if (!doc.destinatario_email) return jsonError(422, 'el documento no tiene email destinatario');
  if (!doc.pdf_storage_path) return jsonError(422, 'el PDF aún no fue generado');

  // 2) Descargar PDF de storage
  const { data: pdfBlob, error: errPdf } = await admin.storage
    .from('cj-documentos')
    .download(doc.pdf_storage_path);
  if (errPdf || !pdfBlob) return jsonError(500, `error descargando PDF: ${errPdf?.message ?? 'no data'}`);

  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

  // 3) Refresh OAuth + Gmail API
  const refreshToken =
    Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
    Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) {
    return jsonError(500, 'OAuth no configurado');
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    return jsonError(502, `OAuth refresh: ${(e as Error).message}`);
  }

  // 4) Armar MIME multipart con attachment
  const subject = `Tu consultoría jurídica · ${doc.titulo}`;
  const html = buildBodyHtml(doc.destinatario_nombre, doc.titulo);
  const pdfFilename = sanitizeFilename(`Consultoria-Juridica-${doc.titulo}.pdf`);
  const mime = buildMimeWithAttachment({
    from: `${encodeRfc2047('Consultoría Jurídica · Gestión Global')} <${FROM}>`,
    to: [doc.destinatario_email],
    replyTo: FROM,
    subject,
    html,
    attachment: {
      filename: pdfFilename,
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    },
  });
  const raw = base64UrlEncode(mime);

  // 5) Send via Gmail API
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
      return jsonError(502, `Gmail ${r.status}: ${txt.slice(0, 500)}`);
    }
    const j = await r.json() as { id?: string };
    providerMsgId = j.id ?? null;
  } catch (e) {
    return jsonError(502, `Gmail error: ${(e as Error).message}`);
  }

  // 6) Registrar en sent_emails + marcar doc como enviado
  const nowIso = new Date().toISOString();
  await admin.from('sent_emails').insert({
    to_email: doc.destinatario_email,
    from_email: FROM,
    from_casilla: 'juridico',
    reply_to: FROM,
    asunto: subject,
    plantilla: 'cj-pdf',
    template_slug: 'cj-pdf',
    html,
    estado: 'sent',
    webhook_status: 'enviado',
    provider_msg_id: providerMsgId,
    zip_attached: false,
  });

  await admin.from('cj_documentos').update({
    last_emailed_at: nowIso,
    last_emailed_to: doc.destinatario_email,
  }).eq('id', doc.id);

  return json({ ok: true, message_id: providerMsgId });
});

// =========================================================================
// Body del email (simple porque el PDF va adjunto)
// =========================================================================
function buildBodyHtml(nombre: string, titulo: string): string {
  const safe = (s: string) => s
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
      <tr><td align="center" style="padding:32px 24px 12px;">
        <img src="https://www.${DOMAIN}/logo-color.png" alt="Gestión Global" style="display:block;max-width:200px;height:auto;" />
      </td></tr>
      <tr><td style="padding:8px 32px 4px;">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#0891b2;">CONSULTORÍA JURÍDICA</p>
      </td></tr>
      <tr><td style="padding:0 32px 8px;">
        <h1 style="margin:0;font-size:24px;line-height:1.18;font-weight:800;color:#0f172a;">${safe(titulo)}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 0;"><hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" /></td></tr>
      <tr><td style="padding:18px 32px 8px;font-size:15px;line-height:1.6;color:#1e293b;">
        <p style="margin:0 0 12px;">Hola ${safe(nombre)},</p>
        <p style="margin:0 0 12px;">Te adjuntamos tu consultoría jurídica en formato PDF para tu revisión y registro.</p>
        <p style="margin:0;">Ante cualquier consulta, podés responder este mismo email.</p>
      </td></tr>
      <tr><td style="padding:12px 32px 24px;font-size:13px;color:#64748b;">Consultoría Jurídica · Gestión Global</td></tr>
      <tr><td style="padding:18px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
        <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.${DOMAIN}" style="color:#0891b2;text-decoration:none;">${DOMAIN}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// =========================================================================
// MIME builder con PDF attachment
// =========================================================================
interface MimeWithAttach {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachment: { filename: string; mimeType: string; bytes: Uint8Array };
}

function buildMimeWithAttachment(a: MimeWithAttach): string {
  const boundary = `bound_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const headers: string[] = [
    `From: ${a.from}`,
    `To: ${a.to.join(', ')}`,
  ];
  if (a.replyTo) headers.push(`Reply-To: ${a.replyTo}`);
  headers.push(`Subject: ${encodeRfc2047(a.subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('X-Auto-Response-Suppress: All');
  headers.push('X-Mailer: Gestion Global Platform');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const htmlBase64 = chunkBase64(btoa(unescape(encodeURIComponent(a.html))));
  const pdfBase64 = chunkBase64(uint8ToBase64(a.attachment.bytes));

  const parts: string[] = [
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    `--${boundary}`,
    `Content-Type: ${a.attachment.mimeType}; name="${a.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${a.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    pdfBase64,
    `--${boundary}--`,
  ];

  return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(bin);
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 100);
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const j = await r.json() as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(`sin access_token (${j.error ?? '?'})`);
  return j.access_token;
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
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
