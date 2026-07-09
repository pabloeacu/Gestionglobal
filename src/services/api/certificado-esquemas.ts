import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type CertificadoEsquemaRow = Database['public']['Tables']['certificado_esquemas']['Row'];
export type CertificadoEsquemaUpdate = Database['public']['Tables']['certificado_esquemas']['Update'];

/** Lista todos los esquemas (gerencia · RLS valida staff). */
export async function listarEsquemas(): Promise<ApiResponse<CertificadoEsquemaRow[]>> {
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .select('*')
    .order('es_default', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) return fail('LIST_FAIL', error.message, error);
  return ok((data ?? []) as CertificadoEsquemaRow[]);
}

/** Devuelve un esquema por id. */
export async function getEsquema(id: string): Promise<ApiResponse<CertificadoEsquemaRow | null>> {
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return fail('GET_FAIL', error.message, error);
  return ok((data ?? null) as CertificadoEsquemaRow | null);
}

/** Devuelve el esquema marcado como default (semilla institucional). */
export async function getEsquemaDefault(): Promise<ApiResponse<CertificadoEsquemaRow | null>> {
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .select('*')
    .eq('es_default', true)
    .maybeSingle();
  if (error) return fail('GET_FAIL', error.message, error);
  return ok((data ?? null) as CertificadoEsquemaRow | null);
}

/** Crea un nuevo esquema (con todos los defaults institucionales del schema SQL). */
export async function crearEsquema(
  input: { nombre: string; descripcion?: string | null },
): Promise<ApiResponse<CertificadoEsquemaRow>> {
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .insert({
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
    })
    .select('*')
    .single();
  if (error) return fail('CREATE_FAIL', error.message, error);
  return ok(data as CertificadoEsquemaRow);
}

/** Duplica un esquema existente — útil para variantes a partir del default. */
export async function duplicarEsquema(
  sourceId: string,
  nuevoNombre: string,
): Promise<ApiResponse<CertificadoEsquemaRow>> {
  const src = await getEsquema(sourceId);
  if (!src.ok) return src;
  if (!src.data) return fail('NOT_FOUND', 'Esquema origen no encontrado');
  const { id: _id, created_at: _c, updated_at: _u, es_default: _d, ...rest } = src.data;
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .insert({ ...rest, nombre: nuevoNombre, es_default: false })
    .select('*')
    .single();
  if (error) return fail('CREATE_FAIL', error.message, error);
  return ok(data as CertificadoEsquemaRow);
}

/** Actualiza campos de un esquema (parcial). */
export async function actualizarEsquema(
  id: string,
  patch: CertificadoEsquemaUpdate,
): Promise<ApiResponse<CertificadoEsquemaRow>> {
  const { data, error } = await supabase
    .from('certificado_esquemas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('UPDATE_FAIL', error.message, error);
  return ok(data as CertificadoEsquemaRow);
}

/** Elimina un esquema. Bloqueado si tiene cursos/webinars vinculados. */
export async function eliminarEsquema(id: string): Promise<ApiResponse<void>> {
  const [cursos, webinars] = await Promise.all([
    supabase.from('cursos').select('id', { count: 'exact', head: true }).eq('cert_esquema_id', id),
    supabase.from('webinars').select('id', { count: 'exact', head: true }).eq('cert_esquema_id', id),
  ]);
  if ((cursos.count ?? 0) > 0 || (webinars.count ?? 0) > 0) {
    return fail(
      'IN_USE',
      'Este esquema está asignado a cursos o eventos. Reasignelos antes de eliminar.',
    );
  }
  const { error } = await supabase.from('certificado_esquemas').delete().eq('id', id);
  if (error) return fail('DELETE_FAIL', error.message, error);
  return ok(undefined);
}

// ============================================================================
// Storage · uploads de imágenes editables (logos / firmas / watermark)
// ============================================================================
const BUCKET = 'certificado-assets';

export type AssetSlot =
  | 'marca_logo'
  | 'firma_1'
  | 'firma_2'
  | 'sello_logo'
  | 'watermark';

/**
 * Sube un archivo al bucket privado y devuelve una URL firmada (1 año) que se
 * persiste en el esquema. Path: `<esquemaId>/<slot>-<timestamp>.<ext>`.
 */
export async function subirAssetEsquema(
  esquemaId: string,
  slot: AssetSlot,
  file: File,
): Promise<ApiResponse<string>> {
  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const ts = Date.now();
    const path = `${esquemaId}/${slot}-${ts}.${ext}`;
    const upload = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      cacheControl: '3600',
      contentType: file.type || undefined,
    });
    if (upload.error) return fail('UPLOAD_FAIL', upload.error.message, upload.error);

    // URL firmada de 365 días (uso institucional, baja rotación).
    const signed = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signed.error) return fail('SIGN_FAIL', signed.error.message, signed.error);
    return ok(signed.data.signedUrl);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Setea es_default true en este esquema y false en cualquier otro. */
export async function setEsquemaDefault(id: string): Promise<ApiResponse<void>> {
  await supabase.from('certificado_esquemas').update({ es_default: false }).eq('es_default', true);
  const { error } = await supabase
    .from('certificado_esquemas')
    .update({ es_default: true })
    .eq('id', id);
  if (error) return fail('UPDATE_FAIL', error.message, error);
  return ok(undefined);
}
