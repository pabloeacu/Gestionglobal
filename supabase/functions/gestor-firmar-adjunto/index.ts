// gestor-firmar-adjunto v1 (E-GG-89): firma URLs de adjuntos del cliente para el
// panel del gestor externo, del lado SERVIDOR con service_role.
//
// Por qué: el gestor entra como `anon` (por token, sin login). El bucket
// `form-adjuntos` es privado y su RLS de storage sólo deja SELECT a staff, así
// que `createSignedUrl` del lado cliente (anon) es rechazado → el adjunto "no
// abre". Acá validamos el token, verificamos que el path pertenezca a los
// adjuntos de ESA solicitud (para no firmar cualquier archivo), y firmamos con
// service_role. verify_jwt = false: la autenticación es el token, no un JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  let body: { token?: string; path?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'JSON inválido'); }
  const token = (body.token ?? '').trim();
  const path = (body.path ?? '').trim();
  if (!token || !path) return jsonError(400, 'token y path requeridos');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Validar el token de acceso externo.
  const { data: acc, error: accErr } = await supabase
    .from('accesos_externos')
    .select('recurso_tipo, recurso_id, revocado_at, vence_at')
    .eq('token', token)
    .maybeSingle();
  if (accErr) return jsonError(500, 'Error validando el acceso');
  if (!acc) return jsonError(401, 'Token inválido');
  if (acc.revocado_at) return jsonError(401, 'Acceso revocado');
  if (acc.vence_at && new Date(acc.vence_at) < new Date()) return jsonError(401, 'Acceso vencido');
  if (acc.recurso_tipo !== 'solicitud' && acc.recurso_tipo !== 'tramite') {
    return jsonError(422, 'Token no asociado a una solicitud');
  }

  // 2) Resolver la solicitud del token.
  let submissionId: string | null = null;
  if (acc.recurso_tipo === 'solicitud') {
    const { data: sol } = await supabase
      .from('solicitudes').select('formulario_submission_id').eq('id', acc.recurso_id).maybeSingle();
    submissionId = (sol?.formulario_submission_id as string | null) ?? null;
  } else {
    const { data: sol } = await supabase
      .from('solicitudes').select('formulario_submission_id')
      .eq('tramite_id', acc.recurso_id).limit(1).maybeSingle();
    submissionId = (sol?.formulario_submission_id as string | null) ?? null;
  }
  if (!submissionId) return jsonError(404, 'Solicitud sin adjuntos');

  // 3) Verificar que el path pertenece a los adjuntos de ESTA solicitud
  //    (candado: el gestor no puede firmar un path arbitrario).
  const { data: adj } = await supabase
    .from('formulario_adjuntos')
    .select('storage_path')
    .eq('submission_id', submissionId)
    .eq('storage_path', path)
    .maybeSingle();
  if (!adj) return jsonError(403, 'El adjunto no pertenece a esta solicitud');

  // 4) Firmar con service_role (bypassa la RLS de storage). download:true fuerza
  //    la descarga en vez de previsualizar.
  const { data: signed, error: signErr } = await supabase.storage
    .from('form-adjuntos')
    .createSignedUrl(path, 3600, { download: true });
  if (signErr || !signed?.signedUrl) return jsonError(500, 'No se pudo firmar el adjunto');

  return new Response(
    JSON.stringify({ ok: true, url: signed.signedUrl }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
