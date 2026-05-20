import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type AdministracionRow = Database['public']['Tables']['administraciones']['Row'];
export type AdministracionInsert = Database['public']['Tables']['administraciones']['Insert'];
export type AdministracionUpdate = Database['public']['Tables']['administraciones']['Update'];
// nombre_normalizado lo completa el trigger; el caller no lo pasa.
export type AdministracionCreateInput = Omit<AdministracionInsert, 'nombre_normalizado'>;

export const ADMINISTRACION_ESTADOS = ['prospecto', 'activo', 'suspendido', 'baja'] as const;
export type AdministracionEstado = (typeof ADMINISTRACION_ESTADOS)[number];

export interface ListAdministracionesParams {
  search?: string;
  estado?: AdministracionEstado | 'todos';
  limit?: number;
  offset?: number;
}

export interface AdministracionListItem extends AdministracionRow {
  consorcios_count: number;
}

export async function listAdministraciones(
  params: ListAdministracionesParams = {},
): Promise<ApiResponse<{ rows: AdministracionListItem[]; total: number }>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let query = supabase
    .from('administraciones')
    .select('*, consorcios:consorcios(count)', { count: 'exact' })
    .order('nombre', { ascending: true })
    .range(offset, offset + limit - 1);

  if (params.estado && params.estado !== 'todos') {
    query = query.eq('estado', params.estado);
  }
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    // ilike sobre nombre + codigo + cuit (best effort)
    query = query.or(
      `nombre.ilike.%${s}%,codigo.ilike.%${s}%,cuit.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return fail('ADMIN_LIST', error.message, error);

  const rows: AdministracionListItem[] = (data ?? []).map((r) => {
    const cAny = (r as { consorcios?: Array<{ count: number }> }).consorcios;
    const consorcios_count = Array.isArray(cAny) && cAny[0] ? cAny[0].count : 0;
    const { consorcios: _drop, ...rest } = r as AdministracionRow & {
      consorcios?: unknown;
    };
    return { ...(rest as AdministracionRow), consorcios_count };
  });

  return ok({ rows, total: count ?? rows.length });
}

export async function getAdministracion(
  id: string,
): Promise<ApiResponse<AdministracionRow>> {
  const { data, error } = await supabase
    .from('administraciones')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return fail('ADMIN_GET', error.message, error);
  return ok(data);
}

export async function createAdministracion(
  input: AdministracionCreateInput,
): Promise<ApiResponse<AdministracionRow>> {
  // nombre_normalizado lo completa el trigger BEFORE INS; mandamos placeholder
  // vacío para satisfacer NOT NULL (el trigger lo sobrescribe).
  const payload: AdministracionInsert = { ...input, nombre_normalizado: '' };
  const { data, error } = await supabase
    .from('administraciones')
    .insert(payload)
    .select()
    .single();
  if (error) return fail('ADMIN_CREATE', error.message, error);
  return ok(data);
}

export async function updateAdministracion(
  id: string,
  patch: AdministracionUpdate,
): Promise<ApiResponse<AdministracionRow>> {
  const { data, error } = await supabase
    .from('administraciones')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('ADMIN_UPDATE', error.message, error);
  return ok(data);
}

export async function archiveAdministracion(
  id: string,
): Promise<ApiResponse<AdministracionRow>> {
  return updateAdministracion(id, { estado: 'baja', activo: false });
}
