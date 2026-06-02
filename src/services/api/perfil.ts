import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, extractEdgeFnError, type ApiResponse } from '@/lib/errors';
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

// Sube avatar a `avatars/<uid>/avatar-<timestamp>.jpg`. El front procesa la
// imagen (crop + zoom + rotación) antes de invocar esta función, así que el
// payload típico ronda los 30-150 KB independientemente del archivo original.
// Aceptamos cualquier Blob de tipo imagen — el editor garantiza el output
// JPEG cuadrado de 512 px.
export async function uploadAvatar(
  blob: Blob,
  ext = 'jpg',
): Promise<ApiResponse<{ publicUrl: string }>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa.');

  // Tope generoso defensivo: ni el editor ni un PNG cuadrado de 512 deberían
  // pasar de unos pocos MB; si llega algo enorme, frenamos antes de quemar
  // ancho de banda del usuario.
  const MAX_BYTES = 8 * 1024 * 1024;
  if (blob.size > MAX_BYTES) {
    return fail('AVATAR_TOO_LARGE', 'La imagen procesada supera los 8MB.');
  }
  if (!blob.type.startsWith('image/')) {
    return fail('AVATAR_INVALID_TYPE', 'El archivo no es una imagen válida.');
  }

  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${auth.user.id}/avatar-${Date.now()}.${safeExt}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: blob.type,
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

// Cambia la contraseña vía edge function `cambiar-mi-password`.
// Por qué la edge fn y no `supabase.auth.updateUser` directo: Supabase Auth
// tiene "Secure password change" + "Require current password" ENABLED
// (AUDIT bonus #272). En ese modo, `updateUser({password})` desde el cliente
// rechaza con "Current password required when setting new password" porque
// supabase-js v2 NO expone `password_current` en el body. La edge fn hace:
//   (1) signInWithPassword en un cliente aislado → verifica current
//   (2) admin.updateUserById con service_role → bypassa la restricción
// Bug reportado: José Luis Saveriano (2026-06-02). Documentado como E-GG-31.
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<ApiResponse<true>> {
  if (newPassword.length < 8) {
    return fail('PASSWORD_TOO_SHORT', 'La contraseña nueva debe tener al menos 8 caracteres.');
  }

  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    error?: string;
  }>('cambiar-mi-password', {
    body: { current: currentPassword, new: newPassword },
  });

  if (error) {
    const msg = await extractEdgeFnError(error);
    // Mantenemos el código semántico para que la UI muestre el mensaje
    // específico cuando aplica.
    const code = msg.toLowerCase().includes('actual no es correcta')
      ? 'CONTRASEÑA_ACTUAL_INVALIDA'
      : 'PASSWORD_UPDATE';
    return fail(code, msg, error);
  }
  if (!data?.ok) {
    const msg = data?.error ?? 'No pudimos actualizar la contraseña.';
    const code = msg.toLowerCase().includes('actual no es correcta')
      ? 'CONTRASEÑA_ACTUAL_INVALIDA'
      : 'PASSWORD_UPDATE';
    return fail(code, msg, data);
  }

  return ok(true);
}
