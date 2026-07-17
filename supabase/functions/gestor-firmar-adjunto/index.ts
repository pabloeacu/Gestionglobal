// gestor-firmar-adjunto v3 (E-GG-89 + E-GG-91 + E-GG-126): firma URLs de los
// documentos del cliente para el panel del gestor externo, del lado SERVIDOR
// con service_role.
//
// Por qué: el gestor entra como `anon` (por token, sin login). Los buckets
// `form-adjuntos` y `pedidos-doc-cliente` son privados y su RLS de storage sólo
// deja SELECT a staff, así que `createSignedUrl` del lado cliente (anon) es
// rechazado → el adjunto "no abre". Acá validamos el token, verificamos que el
// path pertenezca a ESTA solicitud/trámite (candado: el gestor no puede firmar
// un archivo arbitrario), y firmamos con service_role.
//
// v2: además de los adjuntos del formulario original (form-adjuntos), ahora
// firma los documentos que el cliente subió a los "Pedidos de Documentación"
// (bucket pedidos-doc-cliente), acotado al trámite del token y a items
// subido/aprobado (nunca 'pendiente' ni 'rechazado').
//
// v3 (E-GG-126): gestor-uploads pasó a bucket PRIVADO. Fuente 3c: el gestor
// puede firmar (i) sus propias subidas (path que empieza con su token) y
// (ii) archivos presentes en líneas de tracking PUBLICADAS de su trámite.
//
// verify_jwt = false: la autenticación es el token de acceso externo, no un JWT.

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

  // 2) Resolver la solicitud/trámite del token: necesitamos tanto el submission
  //    (para los adjuntos del formulario) como el tramite_id (para los pedidos
  //    de documentación).
  let submissionId: string | null = null;
  let tramiteId: string | null = null;
  if (acc.recurso_tipo === 'solicitud') {
    const { data: sol } = await supabase
      .from('solicitudes').select('formulario_submission_id, tramite_id')
      .eq('id', acc.recurso_id).maybeSingle();
    submissionId = (sol?.formulario_submission_id as string | null) ?? null;
    tramiteId = (sol?.tramite_id as string | null) ?? null;
  } else {
    tramiteId = acc.recurso_id as string;
    const { data: sol } = await supabase
      .from('solicitudes').select('formulario_submission_id')
      .eq('tramite_id', acc.recurso_id).limit(1).maybeSingle();
    submissionId = (sol?.formulario_submission_id as string | null) ?? null;
  }

  // 3) Localizar el path en una de las dos fuentes permitidas y elegir el bucket.
  //    (candado: el gestor sólo firma archivos de SU solicitud/trámite.)
  let bucket: string | null = null;

  //    3a) Adjuntos del formulario original.
  if (submissionId) {
    const { data: adj } = await supabase
      .from('formulario_adjuntos')
      .select('storage_path')
      .eq('submission_id', submissionId)
      .eq('storage_path', path)
      .limit(1)
      .maybeSingle();
    if (adj) bucket = 'form-adjuntos';
  }

  //    3b) Documentos subidos por el cliente a los "Pedidos de Documentación"
  //        de este trámite (sólo subido/aprobado, nunca pendiente/rechazado).
  if (!bucket && tramiteId) {
    const { data: ped } = await supabase
      .from('tramite_pedidos_doc_items')
      .select('archivo_path, estado, tramite_pedidos_doc!inner(tramite_id)')
      .eq('archivo_path', path)
      .eq('tramite_pedidos_doc.tramite_id', tramiteId)
      .in('estado', ['subido', 'aprobado'])
      .limit(1)
      .maybeSingle();
    if (ped) bucket = 'pedidos-doc-cliente';
  }

  //    3c) E-GG-126 · gestor-uploads (privado desde mig 0364): el gestor firma
  //        (i) sus propias subidas — el path arranca con SU token — o
  //        (ii) archivos de líneas de tracking PUBLICADAS de su trámite.
  if (!bucket) {
    if (path.startsWith(token + '/')) {
      bucket = 'gestor-uploads';
    } else if (tramiteId) {
      const { data: lineas } = await supabase
        .from('tracking_lineas')
        .select('archivos_urls')
        .eq('tramite_id', tramiteId)
        .eq('moderacion_estado', 'publicado')
        .not('archivos_urls', 'is', null);
      const presente = (lineas ?? []).some((l) =>
        ((l.archivos_urls as string[] | null) ?? []).some(
          (u) => u === path || u.endsWith('/gestor-uploads/' + path),
        ),
      );
      if (presente) bucket = 'gestor-uploads';
    }
  }

  if (!bucket) return jsonError(403, 'El adjunto no pertenece a esta solicitud');

  // 4) Firmar con service_role (bypassa la RLS de storage). download:true fuerza
  //    la descarga en vez de previsualizar.
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600, { download: true });
  if (signErr || !signed?.signedUrl) return jsonError(500, 'No se pudo firmar el adjunto');

  return new Response(
    JSON.stringify({ ok: true, url: signed.signedUrl }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
