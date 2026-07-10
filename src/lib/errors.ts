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

// ============================================================================
// Helpers de mensajes humanos
//
// Problema observado en E-GG-26/27/28 y al recolectar feedback de usuarios:
// los errores que llegaban a la UI eran técnicos ("Edge Function returned a
// non-2xx status code", "Failed to fetch", "duplicate key value violates
// unique constraint", etc). Los usuarios no podían actuar sobre eso.
//
// Estos helpers consolidan dos patrones que estaban repetidos en arca.ts y
// formularios.ts:
//
//  1. `extractEdgeFnError(err)` lee el body real (4xx/5xx) de
//     FunctionsHttpError de supabase-js. Sin esto el toast queda con
//     "non-2xx status code" genérico aunque el backend haya devuelto un
//     {"error":"Datos inválidos: nombre: requerido"} útil.
//
//  2. `humanizeError({code, message})` mapea códigos PG/supabase típicos +
//     mensajes técnicos comunes a frases en español accionables. Si el
//     mensaje YA es humano (ej. viene del backend después de
//     extractEdgeFnError), se devuelve tal cual.
// ============================================================================

/**
 * Extrae el mensaje real del body de error de una edge function (4xx/5xx).
 * `supabase.functions.invoke` devuelve `FunctionsHttpError` cuyo `.message`
 * es genérico. El body de la respuesta sí trae `{ ok: false, error: "..." }`
 * con detalle pero hay que parsearlo a mano.
 *
 * Uso: `if (error) { const msg = await extractEdgeFnError(error); return fail('CODE', msg, error); }`
 */
export async function extractEdgeFnError(err: unknown): Promise<string> {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { message?: string; context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } };
  try {
    if (e.context?.json) {
      const body = await e.context.json();
      if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
        return (body as { error: string }).error;
      }
    }
  } catch { /* fallthrough */ }
  try {
    if (e.context?.text) {
      const t = await e.context.text();
      if (t) {
        try {
          const j = JSON.parse(t);
          if (j?.error) return String(j.error);
        } catch { /* no es json */ }
        return t.slice(0, 300);
      }
    }
  } catch { /* fallthrough */ }
  return e.message ?? 'Ocurrió un error inesperado.';
}

/**
 * Mapeo de códigos técnicos / mensajes técnicos comunes → frases humanas.
 * Los códigos que empiezan con dígitos son de Postgres / PostgREST.
 * Los códigos UPPER_SNAKE son convenciones del proyecto (services/api/*).
 */
const HUMAN_BY_CODE: Record<string, string> = {
  // Postgres / Supabase
  '42501': 'No tenés permisos para realizar esta acción. Si creés que sí deberías, avisá a un gerente.',
  '23505': 'Ya existe un registro con esos datos. Revisá los campos únicos (email, CUIT, slug, etc).',
  '23503': 'No se pudo guardar porque falta un dato relacionado (cliente, servicio, etc).',
  '23502': 'Falta completar un campo obligatorio.',
  '23514': 'Alguno de los valores no cumple una regla del sistema (revisá fechas y rangos).',
  '22023': 'Alguno de los valores está fuera del rango permitido.',
  'P0002': 'No encontramos lo que buscabas. Puede haber sido borrado.',
  'P0001': 'La operación fue rechazada por una regla del sistema.',
  'PGRST116': 'No encontramos lo que buscabas.',
  'PGRST301': 'Tu sesión expiró. Volvé a ingresar.',
  // Convenciones del proyecto
  'NO_SESSION': 'Tu sesión expiró. Volvé a ingresar.',
  'PROFILE_LOAD': 'No pudimos cargar tu perfil. Verificá tu conexión y reintentá.',
  'PROFILE_LOAD_FAILED': 'No pudimos completar el inicio de sesión. Verificá tu conexión y reintentá.',
  'UNKNOWN': 'Ocurrió un error inesperado. Reintentá en unos segundos.',
};

/**
 * Reglas regex sobre el mensaje técnico. Más generales que el mapa de
 * códigos. Se evalúan SOLO si el código no matcheó.
 */
const HUMAN_BY_MESSAGE: Array<{ re: RegExp; human: string }> = [
  { re: /non-2xx status code/i, human: 'El servidor rechazó la operación. Reintentá; si persiste avisá a un gerente.' },
  { re: /failed to fetch|networkerror|err_network/i, human: 'No pudimos conectar con el servidor. Verificá tu conexión a internet y reintentá.' },
  { re: /timeout|timed out/i, human: 'El servidor tardó demasiado en responder. Reintentá en unos segundos.' },
  { re: /jwt expired|invalid jwt|jwt is invalid/i, human: 'Tu sesión expiró. Volvé a ingresar.' },
  // Reporte JL / DGG-101 · el índice único uq_admin_cuit_activo (un CUIT = una
  // cuenta activa) debe dar un mensaje accionable, no el genérico. Va ANTES de la
  // regla genérica de duplicate-key para matchear primero.
  { re: /uq_admin_cuit_activo/i, human: 'Ya existe un cliente activo con ese CUIT. Buscalo en la lista de clientes y editá o vinculá ese, en vez de crear uno nuevo.' },
  // Reporte JL / auditoría §6 dedup · mensajes específicos por constraint, antes
  // de la regla genérica de duplicate-key para matchear primero.
  { re: /uq_admin_dni_activo/i, human: 'Ya existe un cliente activo (sin CUIT) con ese DNI. Buscalo en la lista de clientes y editá o vinculá ese, en vez de crear uno nuevo.' },
  // Reactivar un cliente de baja cuando ya existe otro activo con el mismo CUIT
  // (reingreso donde se eligió "crear cuenta nueva"). Mensaje accionable en vez
  // del 23505 crudo del índice uq_admin_cuit_activo.
  { re: /reactivar_cuit_duplicado_activo/i, human: 'No se puede reactivar: ya existe otro cliente activo con el mismo CUIT. Revisá cuál corresponde (o fusionalos) antes de reactivar el anterior.' },
  { re: /prospectos_email_key/i, human: 'Ese email ya pertenece a otro prospecto. Buscalo en la lista de prospectos en vez de crear uno nuevo.' },
  { re: /webinar_inscriptos_unique_email/i, human: 'Esa persona ya figura inscripta a este evento.' },
  { re: /uq_curso_matricula/i, human: 'Este alumno ya está inscripto en este curso.' },
  { re: /duplicate key value violates unique constraint/i, human: 'Ya existe un registro con esos datos. Revisá los campos únicos.' },
  { re: /violates foreign key constraint/i, human: 'No se pudo guardar porque falta un dato relacionado.' },
  { re: /violates not-null constraint/i, human: 'Falta completar un campo obligatorio.' },
  { re: /row-level security/i, human: 'No tenés permisos para realizar esta acción.' },
  { re: /rate limit/i, human: 'Hiciste muchas operaciones seguidas. Esperá unos segundos y reintentá.' },
  { re: /aborted|abortcontroller/i, human: 'La operación fue cancelada.' },
  // Supabase Auth · cambio de contraseña (E-GG-39, 2026-06-02). La edge fn
  // `cambiar-mi-password` ya humaniza estos casos antes de devolverlos, pero
  // dejamos los regex acá como defensa en profundidad por si el mensaje
  // crudo escapa desde otro flujo (reset email, signup, etc.).
  { re: /password is known to be weak|password.*compromised|known to be (weak|easy)/i, human: 'La contraseña que elegiste aparece en filtraciones públicas conocidas. Por seguridad, elegí una más original.' },
  { re: /password should be at least|password is too short/i, human: 'La contraseña es muy corta. Probá con una de al menos 8 caracteres.' },
  { re: /new password should be different|same as the old password/i, human: 'La contraseña nueva tiene que ser distinta a la anterior.' },
  { re: /password should contain|character types/i, human: 'La contraseña no cumple los requisitos mínimos.' },
  // E-GG-47 (2026-06-04) · guards de fz_anular_movimiento. La UI ya filtra
  // los botones para que estos casos no aparezcan, pero los humanizamos
  // como defensa en profundidad por si alguien llama la RPC directamente.
  { re: /movimiento_revertido_no_se_puede_anular/i, human: 'Este movimiento ya fue revertido. El par reversión-contrasiento es inmutable; no se puede anular después.' },
  { re: /movimiento_contrasiento_no_se_puede_anular/i, human: 'Los contrasientos generados por una reversión no se anulan: dejarían huérfano al movimiento original del par.' },
  { re: /movimiento_con_imputaciones_usar_revertir/i, human: 'Este movimiento ya está imputado a un comprobante. Para deshacerlo usá "Revertir" en vez de "Anular".' },
  { re: /no_se_puede_revertir_un_contrasiento/i, human: 'Un contrasiento no se revierte (anularía la reversión original). Si te equivocaste al revertir, contactá soporte.' },
  { re: /movimiento_ya_revertido/i, human: 'Este movimiento ya está revertido.' },
  { re: /movimiento_anulado_no_se_revierte/i, human: 'Este movimiento está anulado; no se puede revertir.' },
  // E-GG-47 auditoría (2026-06-04) · invariantes contables capitalizadas a BD.
  { re: /chk_cae_no_anulable|check constraint.*cae/i, human: 'Este comprobante ya tiene CAE de ARCA. Para deshacerlo emití una Nota de Crédito; no se puede anular directamente.' },
  { re: /imputacion_supera_monto_del_movimiento/i, human: 'La imputación que querés registrar es mayor al monto disponible en el movimiento.' },
  { re: /movimiento_inexistente_para_imputacion/i, human: 'El movimiento al que querés imputar ya no existe.' },
  // DGG-42 · errores de tracking_reabrir.
  { re: /solo_staff_puede_reabrir/i, human: 'Sólo el staff de gerencia puede reabrir un trámite.' },
  { re: /tramite_no_cerrado_no_se_reabre/i, human: 'Este trámite no está cerrado, no hay nada para reabrir.' },
  { re: /tramite_inexistente/i, human: 'El trámite que querés reabrir ya no existe.' },
  { re: /motivo_reapertura_requerido/i, human: 'Ingresá un motivo para la reapertura — el cliente y los reportes lo necesitan.' },
];

/**
 * Convierte un error de ApiResponse `{ code, message }` a una frase humana.
 *
 *  - Si el `code` está en el mapa específico → devuelve esa frase.
 *  - Si no, evalúa reglas regex sobre el `message`.
 *  - Si nada matchea, devuelve el `message` original (el backend probablemente
 *    ya lo escribió en español accionable — ej. después de extractEdgeFnError).
 *
 * Uso típico en componentes:
 *   `toast.error('No pudimos guardar', { description: humanizeError(res.error) })`
 *
 * DGG-34 (2026-06-02): la firma acepta también `unknown` para que los
 * `catch (e)` puedan pasarlo directo sin cast. Internamente normaliza a la
 * forma `{ code, message }` o `string`.
 */
type HumanizableErr =
  | { code?: string; message?: string; name?: string; [k: string]: unknown }
  | string
  | null
  | undefined
  | unknown;

export function humanizeError(err: HumanizableErr): string {
  if (err === null || err === undefined) return 'Ocurrió un error inesperado.';
  let code = '';
  let message = '';
  if (typeof err === 'string') {
    message = err;
  } else if (err instanceof Error) {
    message = err.message;
    // PostgrestError, FunctionsHttpError y StorageError llevan `code`/`name`
    const anyErr = err as unknown as { code?: string; name?: string };
    code = anyErr.code ?? '';
    if (!code && anyErr.name && anyErr.name !== 'Error') code = anyErr.name;
  } else if (typeof err === 'object') {
    const obj = err as { code?: unknown; message?: unknown; name?: unknown };
    code = typeof obj.code === 'string' ? obj.code : '';
    message = typeof obj.message === 'string' ? obj.message : '';
    if (!code && typeof obj.name === 'string' && obj.name !== 'Error') code = obj.name;
  } else {
    message = String(err);
  }
  if (code) {
    const hit = HUMAN_BY_CODE[code];
    if (hit) return hit;
  }
  if (message) {
    for (const rule of HUMAN_BY_MESSAGE) {
      if (rule.re.test(message)) return rule.human;
    }
  }
  return message || 'Ocurrió un error inesperado.';
}
