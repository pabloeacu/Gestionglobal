// usuarios · panel de gestión de usuarios (Configuración).
// Lista, crea y elimina users via RPC + edge function `crear-gerente`.
// Citas: regla 4 (queries en services/), regla 12 (tenancy: panel staff-only).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface UsuarioRow {
  user_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
  administracion_id: string | null;
  administracion_nombre: string | null;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  pwa_installed_at: string | null;
  pwa_last_seen_at: string | null;
  push_activo: boolean;
  push_subs_count: number;
  created_at: string;
}

export async function listarUsuarios(): Promise<ApiResponse<UsuarioRow[]>> {
  const { data, error } = await supabase.rpc('gestion_usuarios_listar');
  if (error) return fail('USERS_LIST', error.message, error);
  return ok((data ?? []) as UsuarioRow[]);
}

export async function eliminarGerente(userId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('gestion_gerente_eliminar', { p_user_id: userId });
  if (error) return fail('USERS_DELETE', error.message, error);
  return ok(true);
}

export async function crearGerente(
  email: string,
  nombre: string,
): Promise<ApiResponse<{ user_id: string; password_temporal?: string }>> {
  const { data, error } = await supabase.functions.invoke('crear-gerente', {
    body: { email, nombre },
  });
  if (error) return fail('USERS_CREATE', error.message, error);
  if (!data?.ok) return fail('USERS_CREATE', data?.error ?? 'Error desconocido', data);
  return ok({ user_id: data.user_id, password_temporal: data.password_temporal });
}

// PWA heartbeat: el cliente lo llama al boot si está en standalone mode
export async function reportarPwa(installed: boolean): Promise<void> {
  try {
    await supabase.rpc('gg_profile_marcar_pwa', { p_installed: installed });
  } catch {
    // no es crítico — sólo telemetría
  }
}
