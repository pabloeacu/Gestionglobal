// send-constancia-email · envía la CONSTANCIA DE INSCRIPCIÓN por email con el
// PDF adjunto (chunk CONST). GEMELA de send-certificado-email (que no se toca):
//   1. El browser del gerente ya generó el PDF y lo subió al bucket `certificados`
//      bajo el prefijo constancia/ (path en constancias.pdf_storage_path).
//   2. El frontend invoca esta edge con { constancia_id, enviar_al_alumno, extra_email }.
//   3. La edge resuelve destinatarios (alumno: auth email con fallback al email de
//      su administración; extra: el tipeado por gerencia — p.ej. el RPAC), baja el
//      PDF, arma MIME multipart/mixed con el attachment, lo manda por Gmail
//      (OAuth de contacto@) y marca constancias.enviado_email_at + enviado_a.
//
// Seguridad (doble capa, igual que la gemela): verify_jwt = true en config.toml
// (el caller SIEMPRE es un gerente logueado) + validación interna de
// profiles.role IN ('gerente','operador'). Regla 7: versionada en el repo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const DOMAIN = 'gestionglobal.ar';
const FROM = `contacto@${DOMAIN}`; // casilla GENERAL (principal) — DGG-100

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAFF_ROLES = ['gerente', 'operador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 0) Auth: sólo staff.
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (bearer !== serviceKey) {
    if (!bearer) return jsonError(401, 'no autorizado');
    const { data: u } = await admin.auth.getUser(bearer);
    const uid = u?.user?.id;
    if (!uid) return jsonError(401, 'sesión inválida');
    const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle();
    if (!prof || !STAFF_ROLES.includes(String(prof.role))) {
      return jsonError(403, 'solo gerencia');
    }
  }

  let body: { constancia_id?: string; enviar_al_alumno?: boolean; extra_email?: string | null };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid json'); }
  const constanciaId = body.constancia_id;
  if (!constanciaId) return jsonError(400, 'constancia_id requerido');
  const enviarAlAlumno = body.enviar_al_alumno !== false; // default true
  const extraEmail = (body.extra_email ?? '').trim() || null;

  // 1) Cargar constancia
  const { data: con, error: errCon } = await admin
    .from('constancias')
    .select('id, codigo, curso_id, administracion_id, alumno_profile_id, pdf_storage_path, payload_snapshot')
    .eq('id', constanciaId)
    .maybeSingle();
  if (errCon || !con) return jsonError(404, 'constancia no encontrada');
  if (!con.pdf_storage_path) return jsonError(422, 'el PDF de la constancia aún no fue generado');

  const snap = (con.payload_snapshot ?? {}) as Record<string, unknown>;
  const titulo = String(snap.curso_titulo ?? 'tu curso');
  const nombre = `${String(snap.alumno_nombre ?? '')} ${String(snap.alumno_apellido ?? '')}`.trim() || 'Alumno';

  // 2) Resolver destinatarios
  const destinos = new Set<string>();
  if (enviarAlAlumno) {
    let email: string | null = null;
    if (con.alumno_profile_id) {
      const { data: au } = await admin.auth.admin.getUserById(String(con.alumno_profile_id));
      email = au?.user?.email ?? null;
    }
    if (!email && typeof snap.alumno_email === 'string' && snap.alumno_email) {
      email = String(snap.alumno_email);
    }
    if (email && EMAIL_RE.test(email)) destinos.add(email.toLowerCase());
  }
  if (extraEmail && EMAIL_RE.test(extraEmail)) destinos.add(extraEmail.toLowerCase());
  const to = Array.from(destinos);
  if (to.length === 0) return jsonError(422, 'no se pudo resolver ningún destinatario');

  // 3) Descargar el PDF del bucket certificados (prefijo constancia/)
  const { data: pdfBlob, error: errPdf } = await admin.storage
    .from('certificados')
    .download(con.pdf_storage_path);
  if (errPdf || !pdfBlob) return jsonError(500, `error descargando PDF: ${errPdf?.message ?? 'no data'}`);
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

  // 4) OAuth refresh (contacto@)
  const refreshToken =
    Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
    Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) return jsonError(500, 'OAuth no configurado');

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    return jsonError(502, `OAuth refresh: ${(e as Error).message}`);
  }

  // 5) MIME + send
  const subject = `Constancia de inscripción · ${titulo} · Gestión Global`;
  const html = buildBodyHtml(nombre, titulo);
  const pdfFilename = sanitizeFilename(`Constancia-${con.codigo}.pdf`);
  const mime = buildMimeWithAttachment({
    from: `${encodeRfc2047('Gestión Global')} <${FROM}>`,
    to,
    replyTo: FROM,
    subject,
    html,
    attachment: { filename: pdfFilename, mimeType: 'application/pdf', bytes: pdfBytes },
  });
  const raw = base64UrlEncode(mime);

  let providerMsgId: string | null = null;
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('send-constancia-email · Gmail non-2xx', { status: r.status, body: txt.slice(0, 500) });
      return jsonError(502, 'No pudimos enviar la constancia. Verificá la dirección y reintentá.');
    }
    const j = await r.json() as { id?: string };
    providerMsgId = j.id ?? null;
  } catch (e) {
    console.error('send-constancia-email · Gmail exception', { err: (e as Error).message });
    return jsonError(502, 'No pudimos conectar con Gmail. Reintentá en unos minutos.');
  }

  // 6) sent_emails + marcar enviada
  const nowIso = new Date().toISOString();
  await admin.from('sent_emails').insert({
    to_email: to.join(', '),
    from_email: FROM,
    from_casilla: 'general',
    reply_to: FROM,
    asunto: subject,
    plantilla: 'constancia-inscripcion',
    template_slug: 'constancia-inscripcion',
    html,
    estado: 'sent',
    webhook_status: 'enviado',
    provider_msg_id: providerMsgId,
    administracion_id: con.administracion_id,
    zip_attached: false,
  });
  await admin
    .from('constancias')
    .update({ enviado_email_at: nowIso, enviado_a: to.join(', '), updated_at: nowIso })
    .eq('id', con.id);

  return json({ ok: true, message_id: providerMsgId, to });
});

// =========================================================================
function buildBodyHtml(nombre: string, titulo: string): string {
  const safe = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
      <tr><td align="center" style="padding:32px 24px 12px;">
        <img src="https://www.${DOMAIN}/logo-color.png" alt="Gestión Global" style="display:block;max-width:200px;height:auto;" />
      </td></tr>
      <tr><td style="padding:8px 32px 4px;">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#0891b2;">CONSTANCIA DE INSCRIPCIÓN</p>
      </td></tr>
      <tr><td style="padding:0 32px 8px;">
        <h1 style="margin:0;font-size:24px;line-height:1.18;font-weight:800;color:#0f172a;">${safe(titulo)}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 0;"><hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" /></td></tr>
      <tr><td style="padding:18px 32px 8px;font-size:15px;line-height:1.6;color:#1e293b;">
        <p style="margin:0 0 12px;">Hola,</p>
        <p style="margin:0 0 12px;">Adjuntamos la <strong>constancia de inscripción</strong> de <strong>${safe(nombre)}</strong> al ${safe(titulo)}, en formato PDF.</p>
        <p style="margin:0;">Ante cualquier consulta, respondé este mismo email.</p>
      </td></tr>
      <tr><td style="padding:18px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
        <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.${DOMAIN}" style="color:#0891b2;text-decoration:none;">${DOMAIN}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

interface MimeWithAttach {
  from: string; to: string[]; replyTo?: string; subject: string; html: string;
  attachment: { filename: string; mimeType: string; bytes: Uint8Array };
}
function buildMimeWithAttachment(a: MimeWithAttach): string {
  const boundary = `bound_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const headers: string[] = [`From: ${a.from}`, `To: ${a.to.join(', ')}`];
  if (a.replyTo) headers.push(`Reply-To: ${a.replyTo}`);
  headers.push(`Subject: ${encodeRfc2047(a.subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('X-Auto-Response-Suppress: All');
  headers.push('X-Mailer: Gestion Global Platform');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const htmlBase64 = chunkBase64(btoa(unescape(encodeURIComponent(a.html))));
  const pdfBase64 = chunkBase64(uint8ToBase64(a.attachment.bytes));

  const parts: string[] = [
    '', `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    htmlBase64,
    `--${boundary}`,
    `Content-Type: ${a.attachment.mimeType}; name="${a.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${a.attachment.filename}"`,
    'Content-Transfer-Encoding: base64', '',
    pdfBase64,
    `--${boundary}--`,
  ];
  return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''; const chunkSize = 0x8000;
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
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
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
function chunkBase64(b64: string): string { return b64.replace(/(.{76})/g, '$1\r\n'); }
function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
