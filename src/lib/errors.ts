// Respuesta estandarizada (P-API-01). El front nunca rompe por un error de servicio:
// toda llamada a services/api/ devuelve ApiResponse<T>.
export type ApiResponse<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { ok: true, data, ...(meta ? { meta } : {}) };
}

export function fail(code: string, message: string, details?: unknown): ApiResponse<never> {
  return { ok: false, error: { code, message, details } };
}

// Traduce un error de Supabase/desconocido a un mensaje en español apto para el usuario.
export function toApiError(e: unknown): { code: string; message: string; details?: unknown } {
  if (e && typeof e === 'object' && 'message' in e) {
    const code = 'code' in e && typeof e.code === 'string' ? e.code : 'UNKNOWN';
    return { code, message: String((e as { message: unknown }).message), details: e };
  }
  return { code: 'UNKNOWN', message: 'Ocurrió un error inesperado.', details: e };
}
