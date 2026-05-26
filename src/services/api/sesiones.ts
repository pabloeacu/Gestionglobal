// ============================================================================
// sesiones.ts · listar y cerrar sesiones activas del usuario (P2-#35)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface SesionActiva {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  updated_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  es_actual: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (n: string, p: any) => (supabase.rpc as any)(n, p);

export async function listMisSesiones(): Promise<ApiResponse<SesionActiva[]>> {
  const { data, error } = await rpc('mis_sesiones_activas', {});
  if (error) return fail('SESIONES_LIST', error.message, error);
  return ok((data ?? []) as SesionActiva[]);
}

export async function cerrarMiSesion(
  sessionId: string,
): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('cerrar_mi_sesion', { p_session_id: sessionId });
  if (error) return fail('SESIONES_CERRAR', error.message, error);
  return ok(Boolean(data));
}

/**
 * Parsea un user agent en una etiqueta amigable.
 * Volcado defensivo — UA strings son ruido, pero esto cubre los browsers
 * más usados (Chrome, Safari, Firefox, Edge) + plataforma básica.
 */
export function describeUserAgent(ua: string | null | undefined): {
  browser: string;
  os: string;
  device: 'desktop' | 'mobile' | 'unknown';
} {
  const s = (ua ?? '').toLowerCase();
  let browser = 'Desconocido';
  if (/edg\//.test(s)) browser = 'Edge';
  else if (/chrome\//.test(s) && !/edg\//.test(s)) browser = 'Chrome';
  else if (/firefox\//.test(s)) browser = 'Firefox';
  else if (/safari\//.test(s) && !/chrome\//.test(s)) browser = 'Safari';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';

  let os = 'Desconocido';
  if (/iphone|ipad|ios/.test(s)) os = 'iOS';
  else if (/android/.test(s)) os = 'Android';
  else if (/mac os x|macintosh/.test(s)) os = 'macOS';
  else if (/windows/.test(s)) os = 'Windows';
  else if (/linux/.test(s)) os = 'Linux';

  const device: 'desktop' | 'mobile' | 'unknown' =
    /mobile|android|iphone|ipad/.test(s)
      ? 'mobile'
      : /windows|macintosh|linux/.test(s)
        ? 'desktop'
        : 'unknown';

  return { browser, os, device };
}
