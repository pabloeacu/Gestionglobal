import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type ConfigGlobal = Database['public']['Tables']['config_global']['Row'];

export async function getConfigGlobal(): Promise<ApiResponse<ConfigGlobal>> {
  const { data, error } = await supabase
    .from('config_global')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) return fail('CONFIG_LOAD', error.message, error);
  return ok(data);
}

export async function updateConfigGlobal(
  patch: Database['public']['Tables']['config_global']['Update'],
): Promise<ApiResponse<ConfigGlobal>> {
  const { data, error } = await supabase
    .from('config_global')
    .update(patch)
    .eq('id', 1)
    .select()
    .single();
  if (error) return fail('CONFIG_UPDATE', error.message, error);
  return ok(data);
}

// DGG-27 · Cortina pre-lanzamiento "Proyectando mejoras extraordinarias".
// RPC anon-callable que devuelve si la cortina está activa.
export async function getLandingCoverStatus(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_landing_cover_status');
  if (error) return false; // fail-open · si falla, mostramos landing
  return Boolean(data);
}

export async function setLandingCover(enabled: boolean): Promise<ApiResponse<boolean>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('set_landing_cover', {
    p_enabled: enabled,
  });
  if (error) return fail('LANDING_COVER_SET', error.message, error);
  return ok(Boolean(data));
}
