// arca-test-conexion · WSAA login + WSFE FEDummy. Cachea TA si OK.
// Doc 02 §4.8 ítem 3, P-ARCA-01 (cache TA) · DGG-31.
//
// Body: { emisor_id?: string }  — si no viene, opera sobre es_default.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { wsaaLogin, feDummy, b64ToPem } from '../_shared/arca.ts';
import { resolverEmisor } from '../_shared/emisor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  let emisorId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.emisor_id === 'string' && body.emisor_id.trim()) emisorId = body.emisor_id.trim();
  } catch { /* ignore */ }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let emisor;
  try {
    emisor = await resolverEmisor(admin, emisorId);
  } catch (e) {
    return jsonError(400, (e as Error).message);
  }

  if (!emisor.cert_b64 || !emisor.key_b64) {
    return jsonError(400, 'Falta cert o key del emisor. Completá los pasos previos del wizard.');
  }

  const t0 = Date.now();
  let mensaje: string;
  let ok = false;
  try {
    const certPem = b64ToPem(emisor.cert_b64);
    const keyPem = b64ToPem(emisor.key_b64);
    const ta = await wsaaLogin({ ambiente: emisor.ambiente, certPem, keyPem });
    // Persistir TA cacheado. El TA es por (service, ambiente) — multi-emisor
    // dentro del mismo ambiente comparte cache; aceptable porque WSFE valida
    // en runtime contra el cert que firmó el TA (cada emisor tiene el suyo).
    await admin.from('arca_tokens').upsert(
      {
        service: 'wsfe',
        ambiente: emisor.ambiente,
        token: ta.token,
        sign: ta.sign,
        obtained_at: new Date().toISOString(),
        expires_at: ta.expirationTime,
      },
      { onConflict: 'service,ambiente' },
    );
    const ping = await feDummy(emisor.ambiente);
    ok = ping.appServer === 'OK' && ping.dbServer === 'OK' && ping.authServer === 'OK';
    mensaje = ok
      ? `WSAA + WSFE OK (App=${ping.appServer} Db=${ping.dbServer} Auth=${ping.authServer})`
      : `WSFE responde pero con servidores degradados: App=${ping.appServer} Db=${ping.dbServer} Auth=${ping.authServer}`;
  } catch (e) {
    mensaje = (e as Error).message;
    ok = false;
  }
  const latencia = Date.now() - t0;

  await admin
    .from('arca_emisores')
    .update({
      ultimo_test_at: new Date().toISOString(),
      ultimo_test_ok: ok,
      ultimo_test_msg: mensaje.slice(0, 500),
      ultimo_test_latencia_ms: latencia,
      updated_at: new Date().toISOString(),
    })
    .eq('id', emisor.id);

  return new Response(
    JSON.stringify({ ok, mensaje, latencia_ms: latencia, ambiente: emisor.ambiente, emisor_id: emisor.id }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: ok ? 200 : 400 },
  );
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
