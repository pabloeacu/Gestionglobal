// ============================================================================
// vistas.ts · API de filtros guardados ("Mis vistas") (DGG-37 / P2-#26)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface VistaGuardada {
  id: string;
  nombre: string;
  filtros: Record<string, unknown>;
  es_default: boolean;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (n: string, p: any) => (supabase.rpc as any)(n, p);

export async function listVistas(modulo: string): Promise<ApiResponse<VistaGuardada[]>> {
  const { data, error } = await rpc('vistas_listar', { p_modulo: modulo });
  if (error) return fail('VISTAS_LIST', error.message, error);
  return ok((data ?? []) as VistaGuardada[]);
}

export async function guardarVista(
  modulo: string,
  nombre: string,
  filtros: Record<string, unknown>,
  esDefault = false,
): Promise<ApiResponse<string>> {
  const { data, error } = await rpc('vistas_guardar', {
    p_modulo: modulo,
    p_nombre: nombre,
    p_filtros: filtros,
    p_es_default: esDefault,
  });
  if (error) return fail('VISTAS_GUARDAR', error.message, error);
  return ok(data as string);
}

export async function borrarVista(id: string): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('vistas_borrar', { p_id: id });
  if (error) return fail('VISTAS_BORRAR', error.message, error);
  return ok(Boolean(data));
}

export async function setVistaDefault(id: string): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('vistas_set_default', { p_id: id });
  if (error) return fail('VISTAS_SET_DEFAULT', error.message, error);
  return ok(Boolean(data));
}
