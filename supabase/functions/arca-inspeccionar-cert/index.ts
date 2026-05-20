// arca-inspeccionar-cert · valida un .crt subido, lo matchea con la key
// guardada y persiste si todo OK. Doc 02 §4.8 ítem 2.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { inspeccionarCert, b64ToPem, pemToB64 } from '../_shared/arca.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
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
  if (!profile || profile.role !== 'gerente') return jsonError(403, 'Solo gerentes');

  let body: Body;
  try { body = await req.json(); } catch { return jsonError(400, 'JSON inválido'); }
  const certInput = body.cert_pem ?? (body.cert_b64 ? b64ToPem(body.cert_b64) : '');
  if (!certInput) return jsonError(400, 'cert_b64 o cert_pem requerido');

  // Si no viene con headers PEM, lo asumimos como b64 del cuerpo del cert.
  const certPem = certInput.includes('BEGIN CERTIFICATE')
    ? certInput
    : rePemize(certInput, 'CERTIFICATE');

  // Leer key + cuit guardados.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: cfg, error: cfgErr } = await admin
    .from('arca_config')
    .select('key_b64, cert_alias')
    .eq('id', 1)
    .single();
  if (cfgErr || !cfg) return jsonError(500, 'No pudimos leer arca_config');
  if (!cfg.key_b64) return jsonError(400, 'No hay private key. Generá el CSR primero.');

  const { data: cg } = await admin.from('config_global').select('cuit').eq('id', 1).single();
  const cuitEsperado = cg?.cuit ?? null;

  const keyPem = b64ToPem(cfg.key_b64);
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
  if (cuitEsperado && insp.cuitInSubject && insp.cuitInSubject !== cuitEsperado) {
    return jsonError(400, `CUIT del cert (${insp.cuitInSubject}) no coincide con config_global (${cuitEsperado}).`);
  }

  const { error: upErr } = await admin
    .from('arca_config')
    .update({
      cert_b64: pemToB64(certPem),
      cert_subido_at: new Date().toISOString(),
      cert_valido_desde: insp.validoDesde ?? null,
      cert_valido_hasta: insp.validoHasta ?? null,
      ultimo_test_at: null,
      ultimo_test_ok: null,
      ultimo_test_msg: null,
    })
    .eq('id', 1);
  if (upErr) return jsonError(500, `No pudimos guardar cert: ${upErr.message}`);

  return new Response(
    JSON.stringify({
      ok: true,
      valido_desde: insp.validoDesde,
      valido_hasta: insp.validoHasta,
      subject_cn: insp.subjectCN,
      cuit_in_subject: insp.cuitInSubject,
      match_key: insp.matchKey,
      alias: cfg.cert_alias,
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
