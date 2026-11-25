// ses-event-webhook · DGG-268 F4 — receptor de notificaciones de Amazon SES vía SNS.
//
// Flujo: SES (identity envios.gestionglobal.ar) publica Bounce/Complaint/Delivery en un
// topic SNS → SNS hace POST HTTPS a este endpoint → verificamos la FIRMA de SNS + el
// TopicArn → llamamos a la RPC public.ses_feedback_ingest (idempotente por SNS MessageId)
// que suprime (bounce Permanent / queja) en email_suppression (opt-out GLOBAL, origen='ses'),
// baja la entidad (prospecto/lexph) y estampa sent_emails. Para rebotes/quejas de CLIENTES
// activos, avisa a gerencia (campanita+push+email) reusando notify_all_gerentes — igual que
// el harvester de DSN de Gmail (email-bounce-harvester), pero SES llega por push, no polling.
//
// Seguridad (gate AUDITORIA_HIBRIDO_SES.md punto 8):
//   1. Firma SNS verificada con el certificado X.509 de AWS (node-forge, RSA-SHA1/256).
//      El SigningCertURL se valida contra sns.<region>.amazonaws.com (anti-SSRF).
//   2. TopicArn debe coincidir con SES_SNS_TOPIC_ARN (no aceptamos topics ajenos aunque
//      traigan firma válida de otra cuenta).
//   3. Secreto compartido en el query (?s=SES_WEBHOOK_SECRET): rechazo barato de ruido
//      antes de la verificación criptográfica. La barrera REAL son 1 y 2.
//
// verify_jwt = false (declarado en config.toml): SNS no manda JWT. La auth es la de arriba.
//
// node-forge corre en Deno via esm.sh con ?target=deno (mismo patrón que _shared/arca.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import forge from 'https://esm.sh/node-forge@1.3.1?target=deno';

const EXPECTED_TOPIC_ARN =
  Deno.env.get('SES_SNS_TOPIC_ARN') ??
  'arn:aws:sns:us-east-1:748725066524:gestionglobal-ses-feedback';
const WEBHOOK_SECRET = Deno.env.get('SES_WEBHOOK_SECRET') ?? '';

// Cache de certificados por URL (SNS rota el cert pocas veces; evita refetch en ráfagas).
const certCache = new Map<string, unknown>();

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('ses-event-webhook alive', { status: 200 });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  // (3) Secreto compartido del query — rechazo barato antes de la cripto.
  if (WEBHOOK_SECRET) {
    const s = new URL(req.url).searchParams.get('s') ?? '';
    if (s !== WEBHOOK_SECRET) return json({ ok: false, error: 'forbidden' }, 403);
  }

  let msg: Record<string, unknown>;
  try {
    msg = await req.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  const type = String(msg.Type ?? '');

  // (2) TopicArn allow-list — aplica a TODO tipo de mensaje SNS.
  if (String(msg.TopicArn ?? '') !== EXPECTED_TOPIC_ARN) {
    return json({ ok: false, error: 'topic no permitido' }, 403);
  }

  // (1) Firma SNS.
  const firmaOk = await verifySnsSignature(msg);
  if (!firmaOk) return json({ ok: false, error: 'firma SNS inválida' }, 403);

  // SubscriptionConfirmation / UnsubscribeConfirmation → confirmar visitando SubscribeURL.
  if (type === 'SubscriptionConfirmation' || type === 'UnsubscribeConfirmation') {
    const subUrl = String(msg.SubscribeURL ?? '');
    try {
      const u = new URL(subUrl);
      if (u.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) {
        return json({ ok: false, error: 'SubscribeURL inválida' }, 403);
      }
      if (type === 'SubscriptionConfirmation') {
        const r = await fetch(subUrl);
        console.log(`[ses-webhook] subscription confirm → ${r.status}`);
      }
    } catch (e) {
      return json({ ok: false, error: `confirm fail: ${(e as Error).message}` }, 502);
    }
    return json({ ok: true, confirmed: type });
  }

  if (type !== 'Notification') {
    return json({ ok: true, noted: `tipo ${type} ignorado` });
  }

  // Notification: el campo Message es un JSON string con el evento SES.
  let ev: Record<string, any>;
  try {
    ev = JSON.parse(String(msg.Message ?? '{}'));
  } catch {
    return json({ ok: false, error: 'Message no es JSON' }, 400);
  }

  const kind = String(ev.notificationType ?? ev.eventType ?? '').toLowerCase();
  const mail = (ev.mail ?? {}) as Record<string, any>;
  const providerMsgId: string | null = mail.messageId ?? null;
  const nowIso = new Date().toISOString();

  let tipo = 'other';
  let subtipo: string | null = null;
  let esPermanente = false;
  let emails: string[] = [];
  let feedbackId: string | null = null;
  let eventAt: string = String(mail.timestamp ?? nowIso);

  if (kind === 'bounce') {
    const b = (ev.bounce ?? {}) as Record<string, any>;
    tipo = 'bounce';
    subtipo = [b.bounceType, b.bounceSubType].filter(Boolean).join('/') || null;
    esPermanente = String(b.bounceType ?? '') === 'Permanent';
    emails = (b.bouncedRecipients ?? []).map((r: any) => String(r?.emailAddress ?? '')).filter(Boolean);
    feedbackId = b.feedbackId ?? null;
    eventAt = String(b.timestamp ?? mail.timestamp ?? nowIso);
  } else if (kind === 'complaint') {
    const c = (ev.complaint ?? {}) as Record<string, any>;
    tipo = 'complaint';
    subtipo = c.complaintFeedbackType ?? null;
    emails = (c.complainedRecipients ?? []).map((r: any) => String(r?.emailAddress ?? '')).filter(Boolean);
    feedbackId = c.feedbackId ?? null;
    eventAt = String(c.timestamp ?? mail.timestamp ?? nowIso);
  } else if (kind === 'delivery') {
    const d = (ev.delivery ?? {}) as Record<string, any>;
    tipo = 'delivery';
    emails = (d.recipients ?? []).map((x: any) => String(x ?? '')).filter(Boolean);
    eventAt = String(d.timestamp ?? mail.timestamp ?? nowIso);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: res, error } = await admin.rpc('ses_feedback_ingest', {
    p_sns_message_id: String(msg.MessageId ?? ''),
    p_tipo: tipo,
    p_subtipo: subtipo,
    p_es_permanente: esPermanente,
    p_emails: emails,
    p_provider_msg_id: providerMsgId,
    p_feedback_id: feedbackId,
    p_event_at: eventAt,
    p_payload: ev,
  });

  // Error transitorio de BD → 500 para que SNS reintente (la RPC es idempotente).
  if (error) {
    console.error('[ses-webhook] ingest error', error.message);
    return json({ ok: false, error: `ingest: ${error.message}` }, 500);
  }

  const out = (res ?? {}) as Record<string, any>;

  // Aviso a gerencia SÓLO para clientes (administraciones activas) — no floodear por
  // rebotes de campañas frías. Best-effort: un fallo acá no debe hacer reintentar a SNS.
  const clientes = Array.isArray(out.clientes) ? out.clientes : [];
  for (const c of clientes) {
    try {
      const esQueja = tipo === 'complaint';
      await admin.rpc('notify_all_gerentes', {
        p_evento_codigo: 'email_bounced',
        p_titulo: esQueja ? `Queja de spam: ${c.email}` : `Rebotó un email a ${c.email}`,
        p_cuerpo:
          `${esQueja ? 'Una queja de spam' : 'Un rebote permanente'} de ${c.email} ` +
          `(${c.nombre ?? 'cliente'}). Le cortamos el marketing, pero sigue recibiendo los ` +
          `comprobantes/avisos. Verificá o corregí su mail de acceso desde la ficha.`,
        p_url: `/gerencia/clientes/${c.administracion_id}`,
        p_send_email: true,
        p_related_table: 'administraciones',
        p_related_id: c.administracion_id,
      });
    } catch (e) {
      console.error('[ses-webhook] notify fail', (e as Error).message);
    }
  }

  return json({ ok: true, tipo, duplicate: !!out.duplicate, suprimidos: out.suprimidos ?? 0,
    stamped: out.stamped ?? 0, clientes: clientes.length });
});

// ───────────────────────── Firma SNS (X.509 RSA, node-forge) ─────────────────────────
async function verifySnsSignature(m: Record<string, unknown>): Promise<boolean> {
  try {
    const certUrl = String(m.SigningCertURL ?? m.SigningCertUrl ?? '');
    const u = new URL(certUrl);
    if (u.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) {
      return false;
    }
    let cert = certCache.get(certUrl) as any;
    if (!cert) {
      const pem = await (await fetch(certUrl)).text();
      cert = (forge as any).pki.certificateFromPem(pem);
      certCache.set(certUrl, cert);
    }
    const canonical = canonicalString(m);
    const ver = String(m.SignatureVersion ?? '1');
    const md = (ver === '2' ? (forge as any).md.sha256 : (forge as any).md.sha1).create();
    md.update(canonical, 'utf8');
    const sig = (forge as any).util.decode64(String(m.Signature ?? ''));
    return cert.publicKey.verify(md.digest().bytes(), sig) === true;
  } catch (e) {
    console.error('[ses-webhook] verify error', (e as Error).message);
    return false;
  }
}

// Orden canónico EXACTO de campos firmados por SNS (AWS docs), cada uno "key\nvalue\n".
function canonicalString(m: Record<string, unknown>): string {
  const t = String(m.Type ?? '');
  let keys: string[];
  if (t === 'Notification') {
    keys = (m.Subject !== undefined && m.Subject !== null)
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'Timestamp', 'TopicArn', 'Type'];
  } else {
    keys = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  }
  let s = '';
  for (const k of keys) s += `${k}\n${String((m as Record<string, unknown>)[k])}\n`;
  return s;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
