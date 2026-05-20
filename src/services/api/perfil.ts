import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// Endpoints específicos de "Mi perfil" — separados de profiles.ts porque
// además del UPDATE incluyen Storage (avatar) y auth.updateUser (password).
// Regla 4: nada de supabase.from() en componentes. Regla 1: todo cambio se
// persiste en BD/auth/Storage.

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface UpdateMyProfileInput {
  full_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
}

// Actualiza columnas del propio profile. RLS limita el UPDATE a id = auth.uid().
export async function updateMyProfile(
  patch: UpdateMyProfileInput,
): Promise<ApiResponse<ProfileRow>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa.');

  // Construimos el patch limpio: undefined → no toca la columna, null → la pisa
  // (útil para borrar avatar). Esto evita reescribir campos que no cambiaron.
  const update: Partial<ProfileRow> = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url;

  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', auth.user.id)
    .select()
    .single();

  if (error) return fail('PROFILE_UPDATE', error.message, toApiError(error));
  return ok(data);
}

// Sube avatar a `avatars/<uid>/avatar-<timestamp>.<ext>` (timestamp evita
// caché vieja en CDN/browser). Después actualiza profiles.avatar_url y
// devuelve la public URL.
export async function uploadAvatar(file: File): Promise<ApiResponse<{ publicUrl: string }>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa.');

  const MAX_BYTES = 2 * 1024 * 1024; // 2MB
  if (file.size > MAX_BYTES) {
    return fail('AVATAR_TOO_LARGE', 'La imagen supera los 2MB. Probá con una más liviana.');
  }
  if (!file.type.startsWith('image/')) {
    return fail('AVATAR_INVALID_TYPE', 'El archivo no es una imagen válida.');
  }

  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'png';
  const path = `${auth.user.id}/avatar-${Date.now()}.${safeExt}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
  if (upErr) return fail('AVATAR_UPLOAD', upErr.message, toApiError(upErr));

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const upd = await updateMyProfile({ avatar_url: publicUrl });
  if (!upd.ok) return upd;

  return ok({ publicUrl });
}

// Desreferencia el avatar (no borra el blob — simplicidad y por si querés
// recuperarlo desde el bucket manualmente).
export async function deleteAvatar(): Promise<ApiResponse<ProfileRow>> {
  return updateMyProfile({ avatar_url: null });
}

// Cambia la contraseña: primero re-auth con la actual (defensa contra sesión
// secuestrada / pantalla desbloqueada por terceros), después updateUser.
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<ApiResponse<true>> {
  const { data: authData } = await supabase.auth.getUser();
  const email = authData.user?.email;
  if (!email) return fail('NO_SESSION', 'Sin sesión activa.');

  if (newPassword.length < 8) {
    return fail('PASSWORD_TOO_SHORT', 'La contraseña nueva debe tener al menos 8 caracteres.');
  }

  // Re-auth: signInWithPassword vuelve a emitir tokens (no rompe la sesión).
  const { error: reauthErr } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (reauthErr) {
    return fail(
      'CONTRASEÑA_ACTUAL_INVALIDA',
      'La contraseña actual no es correcta.',
      toApiError(reauthErr),
    );
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) {
    return fail('PASSWORD_UPDATE', updErr.message, toApiError(updErr));
  }

  return ok(true);
}
