import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type Role = 'gerente' | 'operador' | 'administrador' | 'partner';
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface CurrentProfile {
  id: string;
  role: Role;
  administracionId: string | null;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  activo: boolean;
}

function toProfile(row: ProfileRow): CurrentProfile {
  return {
    id: row.id,
    role: row.role as Role,
    administracionId: row.administracion_id,
    fullName: row.full_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    activo: row.activo,
  };
}

// Carga el profile del usuario autenticado actual.
// Si pasás userId, evita un round-trip a auth.getUser() (que bajo HMR/StrictMode
// puede colgarse por el lock interno de supabase-js). Si no, lo resuelve.
export async function getCurrentProfile(
  userId?: string | null,
): Promise<ApiResponse<CurrentProfile | null>> {
  let id = userId ?? null;
  if (!id) {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return ok(null);
    id = auth.user.id;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return fail('PROFILE_LOAD', error.message, toApiError(error));
  if (!data) return ok(null);
  return ok(toProfile(data));
}

// El usuario puede tocar su nombre/teléfono/avatar. El rol y administracion_id
// los gestiona un gerente vía RPC (no por este endpoint).
export async function updateOwnProfile(input: {
  fullName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}): Promise<ApiResponse<CurrentProfile>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa');
  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: input.fullName ?? undefined,
      phone: input.phone ?? undefined,
      avatar_url: input.avatarUrl ?? undefined,
    })
    .eq('id', auth.user.id)
    .select()
    .single();
  if (error) return fail('PROFILE_UPDATE', error.message, toApiError(error));
  return ok(toProfile(data));
}
