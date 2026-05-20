// notify-vencimientos
//
// Disparada nocturnamente por pg_cron via pg_net. Auth con bearer custom
// (CRON_SECRET) en lugar de JWT supabase.
//
// 1. Lee vw_comprobantes_para_avisar.
// 2. Para cada comprobante con dias_para_vto en {7,3,1,-1,-7}, chequea
//    si ya se notificó ese umbral. Si no, manda email + dedup row.
// 3. Resume cantidades en la respuesta.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const UMBRALES = [7, 3, 1, -1, -7];

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: candidatos, error: errCand } = await supabase
    .from('vw_comprobantes_para_avisar')
    .select('*');
  if (errCand) return json({ ok: false, error: errCand.message }, 500);

  const { data: yaEnviados, error: errYa } = await supabase
    .from('comprobante_avisos_vencimiento')
    .select('comprobante_id, umbral_dias');
  if (errYa) return json({ ok: false, error: errYa.message }, 500);

  const yaSet = new Set((yaEnviados ?? []).map((a) => `${a.comprobante_id}:${a.umbral_dias}`));

  const smtpUser = Deno.env.get('WORKSPACE_SMTP_USER');
  const smtpPass = Deno.env.get('WORKSPACE_SMTP_PASS');
  const fromName = Deno.env.get('WORKSPACE_FROM_NAME') ?? 'Gestion Global';
  const replyTo = Deno.env.get('WORKSPACE_REPLY_TO') ?? smtpUser;
  const smtpReady = !!(smtpUser && smtpPass);

  let enviados = 0, saltados = 0, errores = 0;
  const detalle: Array<{ comprobante_id: string; umbral: number; resultado: string }> = [];

  for (const c of (candidatos ?? []) as Candidato[]) {
    const dias = c.dias_para_vto;
    if (!UMBRALES.includes(dias)) continue;
    const key = `${c.comprobante_id}:${dias}`;
    if (yaSet.has(key)) { saltados++; continue; }

    const { data: emails } = await supabase
      .from('administracion_emails')
      .select('email')
      .eq('administracion_id', c.administracion_id)
      .eq('activo', true)
      .eq('recibe_cobranzas', true);
    const to = (emails ?? []).map((e) => e.email);
    if (to.length === 0) {
      detalle.push({ comprobante_id: c.comprobante_id, umbral: dias, resultado: 'sin_destinatarios' });
      saltados++; continue;
    }

    if (!smtpReady) {
      detalle.push({ comprobante_id: c.comprobante_id, umbral: dias, resultado: 'smtp_no_configurado' });
      errores++; continue;
    }

    const subject = subjectFor(c, dias);
    const html = htmlFor(c, dias);

    try {
      const client = new SMTPClient({
        connection: { hostname: 'smtp.gmail.com', port: 587, tls: false, auth: { username: smtpUser!, password: smtpPass! } },
      });
      await client.send({
        from: `${fromName} <${smtpUser}>`,
        to,
        replyTo,
        subject,
        content: stripHtml(html),
        html,
      });
      await client.close();

      const { data: sentRow } = await supabase
        .from('sent_emails')
        .insert({
          to_email: to[0]!,
          cc: to.length > 1 ? to.slice(1).join(', ') : null,
          from_email: smtpUser!,
          reply_to: replyTo,
          asunto: subject,
          plantilla: 'recordatorio_vencimiento',
          html,
          estado: 'sent',
          comprobante_id: c.comprobante_id,
          administracion_id: c.administracion_id,
          consorcio_id: c.consorcio_id,
          zip_attached: false,
        })
        .select('id')
        .single();

      await supabase
        .from('comprobante_avisos_vencimiento')
        .insert({ comprobante_id: c.comprobante_id, umbral_dias: dias, sent_email_id: sentRow?.id ?? null });

      enviados++;
      detalle.push({ comprobante_id: c.comprobante_id, umbral: dias, resultado: 'ok' });
    } catch (e) {
      errores++;
      detalle.push({ comprobante_id: c.comprobante_id, umbral: dias, resultado: `error: ${(e as Error).message}` });
    }
  }

  return json({ ok: true, enviados, saltados, errores, total_candidatos: candidatos?.length ?? 0, detalle }, 200);
});

interface Candidato {
  comprobante_id: string;
  administracion_id: string;
  consorcio_id: string | null;
  tipo: string;
  punto_venta: number;
  numero: number;
  vencimiento: string;
  total: number;
  saldo_pendiente: number;
  receptor_razon_social: string;
  dias_para_vto: number;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function subjectFor(c: Candidato, dias: number): string {
  if (dias < 0) return `URGENTE: comprobante ${comprobanteStr(c)} vencido hace ${-dias} días`;
  if (dias === 0) return `Vence hoy: comprobante ${comprobanteStr(c)}`;
  if (dias === 1) return `Vence mañana: comprobante ${comprobanteStr(c)}`;
  return `Recordatorio: comprobante ${comprobanteStr(c)} vence en ${dias} días`;
}

function comprobanteStr(c: Candidato): string {
  return `${c.tipo} ${String(c.punto_venta).padStart(5,'0')}-${String(c.numero).padStart(8,'0')}`;
}

function htmlFor(c: Candidato, dias: number): string {
  const saldoFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(Number(c.saldo_pendiente));
  const vencFmt = new Date(c.vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const headline = dias < 0
    ? `Comprobante vencido hace ${-dias} días`
    : dias === 0
      ? 'Comprobante vence hoy'
      : `Comprobante vence en ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const banner = dias < 0 ? '#dc2626' : dias <= 1 ? '#f59e0b' : '#009eca';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body style="margin:0;background:#f8fafc;font-family:Inter,Helvetica,Arial,sans-serif;color:#0d1e2f;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:${banner};padding:28px 28px;color:#fff;"><p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">Gestion Global</p><h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">${headline}</h1></div><div style="padding:28px;"><p style="margin:0 0 12px;font-size:14px;line-height:1.55;">Hola <strong>${escapeHtml(c.receptor_razon_social)}</strong>,</p><p style="margin:0 0 16px;font-size:14px;line-height:1.55;">Te recordamos que el comprobante <strong>${comprobanteStr(c)}</strong> con vencimiento <strong>${vencFmt}</strong> tiene un saldo pendiente de <strong>${saldoFmt}</strong>.</p><p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;">Si ya realizaste el pago, ignorá este aviso o respondé este email con el comprobante. Si necesitás otra forma de pago o un detalle, podemos ayudarte.</p><p style="margin:0;font-size:13px;color:#475569;">Saludos,<br/><strong>Gestión Global</strong></p></div><div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">gestionglobal.ar · Aliados de tu tiempo</div></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
