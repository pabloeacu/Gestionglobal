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
