// arca-generar-csr · genera par RSA 2048 + CSR PKCS#10 y persiste en arca_config.
// Verify JWT manual (P-API-05): chequeamos rol gerente.
// Cita doc 02 §4.8 ítem 1, P-ARCA-04 (configuración self-service).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { generarCsrPkcs10, pemToB64 } from '../_shared/arca.ts';

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

  // Validar rol gerente con la sesión del caller.
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return jsonError(401, 'Sesión inválida');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userRes.user.id)
    .single();
  if (!profile || profile.role !== 'gerente') {
    return jsonError(403, 'Solo gerentes pueden generar CSR');
  }

  // Leer config_global para CUIT y razón social.
  const { data: cfg, error: cfgErr } = await supabase
    .from('config_global')
    .select('cuit, razon_social')
    .eq('id', 1)
    .single();
  if (cfgErr || !cfg) return jsonError(500, 'No pudimos leer config_global');
  if (!cfg.cuit) {
    return jsonError(400, 'config_global.cuit no está cargado. Cargá el CUIT antes de generar CSR.');
  }

  let alias: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.alias === 'string' && body.alias.trim()) alias = body.alias.trim();
  } catch { /* ignore */ }

  let csrPem: string;
  let keyPem: string;
  try {
    const out = generarCsrPkcs10({ cuit: cfg.cuit, razonSocial: cfg.razon_social, alias });
    csrPem = out.csrPem;
    keyPem = out.keyPem;
  } catch (e) {
    return jsonError(500, `Generación CSR falló: ${(e as Error).message}`);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { error: upErr } = await admin
    .from('arca_config')
    .update({
      csr_b64: pemToB64(csrPem),
      key_b64: pemToB64(keyPem),
      csr_generado_at: new Date().toISOString(),
      cert_b64: null,
      cert_subido_at: null,
      cert_valido_desde: null,
      cert_valido_hasta: null,
      cert_alias: alias ?? `gestion-global-${cfg.cuit}`,
      ultimo_test_at: null,
      ultimo_test_ok: null,
      ultimo_test_msg: null,
    })
    .eq('id', 1);
  if (upErr) return jsonError(500, `No pudimos guardar CSR: ${upErr.message}`);

  return new Response(
    JSON.stringify({
      ok: true,
      csr_pem: csrPem,
      alias_sugerido: alias ?? `gestion-global-${cfg.cuit}`,
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
