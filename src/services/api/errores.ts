// ============================================================================
// errores.ts · API del sistema propio de error tracking (DGG-38 / P2-#31)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface ErrorRuntimeRow {
  id: string;
  fingerprint: string;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  user_id: string | null;
  user_email: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
  resuelto_at: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (n: string, p: any) => (supabase.rpc as any)(n, p);

export async function listErrores(
  soloNoResueltos = true,
  limit = 50,
): Promise<ApiResponse<ErrorRuntimeRow[]>> {
  const { data, error } = await rpc('errores_listar', {
    p_limit: limit,
    p_solo_no_resueltos: soloNoResueltos,
  });
  if (error) return fail('ERRORES_LIST', error.message, error);
  return ok((data ?? []) as ErrorRuntimeRow[]);
}

export async function marcarErrorResuelto(id: string): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('errores_marcar_resuelto', { p_id: id });
  if (error) return fail('ERRORES_RESUELTO', error.message, error);
  return ok(Boolean(data));
}
