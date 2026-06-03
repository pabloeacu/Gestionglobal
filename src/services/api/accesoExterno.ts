// accesoExterno · service para la página pública de gestor externo
// (`/acceso/:token`). Capitaliza supabase.* que vivía en
// `AccesoExternoPage.tsx` (E-GG-26 R4 sweep, DGG-34, 2026-06-02):
//   - RPC `gestor_obtener_info_solicitud` (lectura por token).
//   - Storage signed URL para adjuntos del cliente (bucket `form-adjuntos`).
//   - Storage upload + getPublicUrl en bucket `gestor-uploads`.
//
// Mantenemos el bucket name como constante exportada por si otros módulos
// (TrackingDetailPage) deciden compartir el helper.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export const GESTOR_UPLOADS_BUCKET = 'gestor-uploads';
export const FORM_ADJUNTOS_BUCKET = 'form-adjuntos';

/** Devuelve la info de una solicitud accedida por token de gestor externo. */
export async function obtenerInfoSolicitudPorToken(
  token: string,
): Promise<ApiResponse<unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    'gestor_obtener_info_solicitud',
    { p_token: token },
  );
  if (error) return fail('ACCESO_EXT_INFO', error.message, error);
  return ok(data as unknown);
}

/** Devuelve una URL firmada (10 minutos) para descargar un adjunto del
 * cliente desde `form-adjuntos`. El bucket es privado, sólo el gestor con
 * token vigente accede via service en backend RPC; el frontend usa este
 * helper para mostrar el archivo. */
export async function firmarAdjuntoCliente(
  path: string,
  expiresInSeconds = 600,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.storage
    .from(FORM_ADJUNTOS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    return fail('ACCESO_EXT_FIRMA', error?.message ?? 'no signed url', error);
  }
  return ok(data.signedUrl);
}

/** Sube un archivo del gestor externo al bucket `gestor-uploads`. El path
 * empieza siempre con el token de acceso (la policy de bucket lo exige). */
export async function subirAdjuntoGestor(
  token: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${token}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeStorageKey(file.name)}`;
  const { error } = await supabase.storage
    .from(GESTOR_UPLOADS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return fail('ACCESO_EXT_UPLOAD', error.message, error);
  const { data } = supabase.storage.from(GESTOR_UPLOADS_BUCKET).getPublicUrl(path);
  return ok(data.publicUrl);
}
