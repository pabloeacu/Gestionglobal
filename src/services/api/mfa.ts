// ============================================================================
// mfa.ts · Multi-factor authentication TOTP via Supabase Auth (P2-#33)
//
// Supabase Auth tiene MFA nativo. Estos wrappers exponen lo mínimo necesario:
//   • listFactors() → factors activos del user
//   • enrollTotp() → crea un factor pending + devuelve qr_code + secret
//   • verifyEnroll(factorId, code) → confirma el código TOTP, activa el factor
//   • challengeAndVerify(factorId, code) → para uso en login (upgrade aal1→aal2)
//   • unenroll(factorId) → remueve un factor activo
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface MfaFactor {
  id: string;
  factor_type: 'totp' | string;
  friendly_name?: string;
  status: 'verified' | 'unverified' | string;
  created_at?: string;
}

export interface EnrollResult {
  factorId: string;
  qrCode: string;     // data URI SVG
  secret: string;     // base32, mostrar para que el user pueda agregar a mano
  uri: string;        // otpauth:// URI completo
}

export async function listFactors(): Promise<ApiResponse<MfaFactor[]>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return fail('MFA_LIST', error.message, error);
  const totp = (data.totp ?? []) as unknown as MfaFactor[];
  return ok(totp);
}

export async function enrollTotp(
  friendlyName: string = 'Mi autenticador',
): Promise<ApiResponse<EnrollResult>> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) return fail('MFA_ENROLL', error.message, error);
  if (!data?.id || !data.totp) return fail('MFA_ENROLL', 'Sin datos TOTP');
  return ok({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}

export async function verifyEnroll(
  factorId: string,
  code: string,
): Promise<ApiResponse<true>> {
  // Hay que hacer challenge primero, después verify con el challengeId.
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error || !ch.data?.id) return fail('MFA_CHALLENGE', ch.error?.message ?? 'Sin challenge');
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.data.id,
    code,
  });
  if (error) return fail('MFA_VERIFY', error.message, error);
  return ok(true);
}

export async function unenroll(factorId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return fail('MFA_UNENROLL', error.message, error);
  return ok(true);
}

/**
 * Para el login: después de un signInWithPassword exitoso, si el user tiene
 * factors verified, hay que upgradear el AAL con un challenge + verify.
 * Devuelve true si el user NO tiene MFA, o si lo verificó correctamente.
 */
export async function getAuthAal(): Promise<ApiResponse<{ currentLevel: 'aal1' | 'aal2'; nextLevel: 'aal1' | 'aal2' }>> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return fail('MFA_AAL', error.message, error);
  return ok({
    currentLevel: (data.currentLevel ?? 'aal1') as 'aal1' | 'aal2',
    nextLevel: (data.nextLevel ?? 'aal1') as 'aal1' | 'aal2',
  });
}

export async function challengeAndVerify(
  factorId: string,
  code: string,
): Promise<ApiResponse<true>> {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error || !ch.data?.id) return fail('MFA_CHALLENGE', ch.error?.message ?? 'Sin challenge');
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.data.id,
    code,
  });
  if (error) return fail('MFA_VERIFY', error.message, error);
  return ok(true);
}
