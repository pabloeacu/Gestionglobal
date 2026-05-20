// supabase/functions/send-comprobante-email/index.ts
//
// Envía el comprobante por email vía SMTP de Google Workspace (denomailer).
// Contrato neutro de credenciales: lee 3 secrets que sirven tanto para App
// Password como para OAuth2 (XOAUTH2 access_token reemplaza el password).
//
//   WORKSPACE_SMTP_USER         e.g. facturacion@gestionglobal.ar
//   WORKSPACE_SMTP_PASS         App Password (16 chars) o access_token OAuth2
//   WORKSPACE_FROM_NAME         e.g. Gestión Global
//   WORKSPACE_REPLY_TO          (opcional) e.g. cobranzas@gestionglobal.ar
//
// Registra el envío en public.sent_emails con la fila completa para auditoría.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
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

  const smtpUser = Deno.env.get('WORKSPACE_SMTP_USER');
  const smtpPass = Deno.env.get('WORKSPACE_SMTP_PASS');
  const fromName = Deno.env.get('WORKSPACE_FROM_NAME') ?? 'Gestion Global';
  const replyTo = Deno.env.get('WORKSPACE_REPLY_TO') ?? smtpUser;

  if (!smtpUser || !smtpPass) {
    return jsonError(500, 'SMTP no configurado: faltan secrets WORKSPACE_SMTP_USER / WORKSPACE_SMTP_PASS');
  }

  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 587, tls: false, auth: { username: smtpUser, password: smtpPass } },
  });

  const attachments = payload.pdf_base64 ? [{
    filename: payload.pdf_filename ?? `comprobante-${numStr}.pdf`,
    content: payload.pdf_base64,
    encoding: 'base64' as const,
    contentType: 'application/pdf',
  }] : undefined;

  try {
    await client.send({
      from: `${fromName} <${smtpUser}>`,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      replyTo,
      subject,
      content: stripHtml(html),
      html,
      attachments,
    });
  } catch (e) {
    await client.close();
    return jsonError(502, `SMTP fallo: ${(e as Error).message}`);
  }
  await client.close();

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: logged, error: errLog } = await admin
    .from('sent_emails')
    .insert({
      to_email: payload.to[0]!,
      cc: payload.cc?.join(', ') ?? null,
      from_email: smtpUser,
      reply_to: replyTo,
      asunto: subject,
      plantilla: 'comprobante_default',
      html,
      attachments_meta: attachments ? [{ filename: attachments[0]!.filename, kind: 'pdf' }] : null,
      estado: 'sent',
      comprobante_id: comp.id,
      administracion_id: comp.administracion_id,
      consorcio_id: comp.consorcio_id,
      zip_attached: false,
    })
    .select('id')
    .single();

  if (!errLog) {
    await admin
      .from('comprobantes')
      .update({ email_enviado_at: new Date().toISOString(), email_envios_count: 1 })
      .eq('id', comp.id);
  }

  return new Response(JSON.stringify({ ok: true, sent_email_id: logged?.id ?? null, to: payload.to, subject }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function defaultEmailHtml(comp: { tipo: string; fecha: string; vencimiento: string | null; total: number | string | null; receptor_razon_social: string; observaciones: string | null }, numStr: string): string {
  const total = Number(comp.total ?? 0);
  const totalFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(total);
  const fechaFmt = new Date(comp.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const vencFmt = comp.vencimiento ? new Date(comp.vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Comprobante ${comp.tipo} ${numStr}</title></head><body style="margin:0;background:#f8fafc;font-family:Inter,Helvetica,Arial,sans-serif;color:#0d1e2f;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -10px rgba(15,23,42,0.18);"><div style="background:linear-gradient(135deg,#009eca 0%,#16a0a2 100%);padding:32px 28px;color:#fff;"><p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">Gestion Global</p><h1 style="margin:6px 0 0;font-size:24px;font-weight:800;">Comprobante ${comp.tipo} ${numStr}</h1></div><div style="padding:28px;"><p style="margin:0 0 10px;font-size:14px;line-height:1.55;">Hola <strong>${escapeHtml(comp.receptor_razon_social)}</strong>,</p><p style="margin:0 0 18px;font-size:14px;line-height:1.55;">Te enviamos el comprobante correspondiente al servicio detallado a continuacion. Adjuntamos el PDF para tu registro.</p><div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:18px;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><td style="padding:6px 0;color:#64748b;">Fecha de emision</td><td style="padding:6px 0;text-align:right;font-weight:600;">${fechaFmt}</td></tr>${vencFmt ? `<tr><td style="padding:6px 0;color:#64748b;">Vencimiento</td><td style="padding:6px 0;text-align:right;font-weight:600;">${vencFmt}</td></tr>` : ''}<tr style="border-top:2px solid #009eca;"><td style="padding:12px 0 4px;color:#009eca;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.08em;">Total</td><td style="padding:12px 0 4px;text-align:right;color:#009eca;font-weight:800;font-size:20px;">${totalFmt}</td></tr></table></div>${comp.observaciones ? `<p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.55;background:#f8fafc;padding:12px 14px;border-radius:8px;">${escapeHtml(comp.observaciones)}</p>` : ''}<p style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#475569;">Si tenes alguna consulta, podes responder este email.</p><p style="margin:0;font-size:13px;line-height:1.55;color:#475569;">Saludos,<br/><strong>Gestion Global</strong></p></div><div style="background:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">Gestion Global · gestionglobal.ar · Aliados de tu tiempo</div></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
