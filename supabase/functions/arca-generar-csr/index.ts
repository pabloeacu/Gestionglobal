// arca-generar-csr · genera par RSA 2048 + CSR PKCS#10 y persiste en
// arca_emisores. Verify JWT manual (P-API-05): chequeamos rol staff.
//
// Body: { emisor_id?: string; alias?: string }
//   - emisor_id opcional: si no viene, opera sobre el es_default. Cita DGG-31.
//   - alias opcional: por defecto "gestion-global-{CUIT}".
//
// Cita doc 02 §4.8 ítem 1, P-ARCA-04 (configuración self-service).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { generarCsrPkcs10, pemToB64 } from '../_shared/arca.ts';
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

  // Validar rol staff con la sesión del caller.
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return jsonError(401, 'Sesión inválida');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userRes.user.id)
    .single();
  if (!profile || (profile.role !== 'gerente' && profile.role !== 'operador')) {
    return jsonError(403, 'Solo staff (gerente u operador) pueden generar CSR');
  }

  let emisorId: string | undefined;
  let alias: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.emisor_id === 'string' && body.emisor_id.trim()) emisorId = body.emisor_id.trim();
    if (typeof body?.alias === 'string' && body.alias.trim()) alias = body.alias.trim();
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

  if (!emisor.cuit) {
    return jsonError(400, `El emisor "${emisor.nombre}" no tiene CUIT cargado. Editá los datos fiscales antes de generar el CSR.`);
  }

  const aliasFinal = alias ?? `gestion-global-${emisor.cuit}`;

  let csrPem: string;
  let keyPem: string;
  try {
    const out = await generarCsrPkcs10({ cuit: emisor.cuit, razonSocial: emisor.razon_social, alias: aliasFinal });
    csrPem = out.csrPem;
    keyPem = out.keyPem;
  } catch (e) {
    return jsonError(500, `Generación CSR falló: ${(e as Error).message}`);
  }

  const { error: upErr } = await admin
    .from('arca_emisores')
    .update({
      csr_b64: pemToB64(csrPem),
      key_b64: pemToB64(keyPem),
      csr_generado_at: new Date().toISOString(),
      // Limpiar cert anterior porque ya no matcheará con la nueva key.
      cert_b64: null,
      cert_subido_at: null,
      cert_valido_desde: null,
      cert_valido_hasta: null,
      cert_alias: aliasFinal,
      ultimo_test_at: null,
      ultimo_test_ok: null,
      ultimo_test_msg: null,
      ultimo_test_latencia_ms: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', emisor.id);
  if (upErr) return jsonError(500, `No pudimos guardar CSR: ${upErr.message}`);

  return new Response(
    JSON.stringify({
      ok: true,
      emisor_id: emisor.id,
      csr_pem: csrPem,
      alias_sugerido: aliasFinal,
      instrucciones: [
        '1. Descargá el CSR (.csr) con el botón "Descargar".',
        '2. Entrá a https://auth.afip.gob.ar (clave fiscal nivel 3).',
        '3. Buscá "Administración de Certificados Digitales".',
        '4. Creá un nuevo certificado y subí el .csr con el alias indicado.',
        '5. AFIP te devolverá un .crt o .cer. Volvé acá y subilo en el siguiente paso.',
        '6. En "Administrador de Relaciones" autorizá el WS Negocio "Facturación Electrónica (wsfe)" con el alias creado.',
      ],
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
