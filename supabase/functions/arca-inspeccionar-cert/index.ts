// arca-inspeccionar-cert · valida un .crt subido, lo matchea con la key
// guardada del emisor y persiste si todo OK. Doc 02 §4.8 ítem 2 · DGG-31.
//
// Body: { emisor_id?: string; cert_b64?: string; cert_pem?: string }
//   - emisor_id opcional: si no viene opera sobre el es_default.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { inspeccionarCert, b64ToPem, pemToB64 } from '../_shared/arca.ts';
import { resolverEmisor } from '../_shared/emisor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  emisor_id?: string;
  cert_b64?: string; // base64 del PEM completo, o del cert raw (sin BEGIN/END).
  cert_pem?: string; // alternativamente el PEM con headers.
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonError(401, 'Falta Authorization header');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );

  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return jsonError(401, 'Sesión inválida');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userRes.user.id).single();
  if (!profile || (profile.role !== 'gerente' && profile.role !== 'operador')) {
    return jsonError(403, 'Solo staff');
  }

  let body: Body;
  try { body = await req.json(); } catch { return jsonError(400, 'JSON inválido'); }
  const certInput = body.cert_pem ?? (body.cert_b64 ? b64ToPem(body.cert_b64) : '');
  if (!certInput) return jsonError(400, 'cert_b64 o cert_pem requerido');

  // Si no viene con headers PEM, lo asumimos como b64 del cuerpo del cert.
  const certPem = certInput.includes('BEGIN CERTIFICATE')
    ? certInput
    : rePemize(certInput, 'CERTIFICATE');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let emisor;
  try {
    emisor = await resolverEmisor(admin, body.emisor_id);
  } catch (e) {
    return jsonError(400, (e as Error).message);
  }

  if (!emisor.key_b64) return jsonError(400, 'No hay private key cargada. Generá el CSR primero (Paso 1).');

  const keyPem = b64ToPem(emisor.key_b64);
  const insp = inspeccionarCert(certPem, keyPem);

  if (!insp.ok) return jsonError(400, `Certificado inválido: ${insp.error}`);

  if (insp.matchKey === false) {
    return jsonError(400, 'El certificado no matchea con la private key guardada. Regenerá el CSR.');
  }

  const ahora = new Date().toISOString().slice(0, 10);
  if (insp.validoHasta && insp.validoHasta < ahora) {
    return jsonError(400, `Certificado vencido (${insp.validoHasta}). Renová en AFIP.`);
  }
  if (insp.validoDesde && insp.validoDesde > ahora) {
    return jsonError(400, `Certificado aún no vigente (válido desde ${insp.validoDesde}).`);
  }
  if (emisor.cuit && insp.cuitInSubject && insp.cuitInSubject !== emisor.cuit) {
    return jsonError(400, `CUIT del cert (${insp.cuitInSubject}) no coincide con el del emisor (${emisor.cuit}).`);
  }

  const { error: upErr } = await admin
    .from('arca_emisores')
    .update({
      cert_b64: pemToB64(certPem),
      cert_subido_at: new Date().toISOString(),
      cert_valido_desde: insp.validoDesde ?? null,
      cert_valido_hasta: insp.validoHasta ?? null,
      ultimo_test_at: null,
      ultimo_test_ok: null,
      ultimo_test_msg: null,
      ultimo_test_latencia_ms: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', emisor.id);
  if (upErr) return jsonError(500, `No pudimos guardar cert: ${upErr.message}`);

  return new Response(
    JSON.stringify({
      ok: true,
      emisor_id: emisor.id,
      valido_desde: insp.validoDesde,
      valido_hasta: insp.validoHasta,
      subject_cn: insp.subjectCN,
      cuit_in_subject: insp.cuitInSubject,
      match_key: insp.matchKey,
      alias: emisor.cert_alias,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

function rePemize(b64body: string, kind: 'CERTIFICATE'): string {
  const clean = b64body.replace(/\s+/g, '').replace(/-----[^-]+-----/g, '');
  const lines = clean.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join('\n')}\n-----END ${kind}-----\n`;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
