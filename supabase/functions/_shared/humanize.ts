// ============================================================================
// _shared/humanize.ts · helper para traducir errores de servicios externos
// a copy humano en español accionable.
//
// Capitalizado del E-GG-39 + sweep Pattern-5 (2026-06-02 · José Luis).
// Toda edge fn que envuelve un servicio externo (Supabase Auth, Resend,
// Gmail API, ARCA SOAP, Zoom, Webex) y devuelve el error al cliente DEBE
// pasar `err.message` por `humanizeUpstream()` antes de propagarlo al
// frontend.
//
// Patrón canónico:
//   const { error: e } = await admin.auth.admin.updateUserById(uid, {...});
//   if (e) return json(422, { ok: false, error: humanizeUpstream(e.message) });
//
// Si tu edge fn es un cron/webhook background (no llega al UI), podés
// seguir usando `err.message` crudo — solo va a logs.
// ============================================================================

interface MapEntry {
  re: RegExp;
  human: string;
  status?: number; // status HTTP sugerido si la edge fn devuelve el msg
}

const COMMON_MAPS: MapEntry[] = [
  // ---------- Supabase Auth ----------
  { re: /password is known to be weak|password.*compromised|known to be (weak|easy)/i,
    human: 'La contraseña que elegiste aparece en filtraciones públicas conocidas. Por seguridad, elegí una más original (combiná mayúsculas, minúsculas, números y un símbolo).',
    status: 422 },
  { re: /password should be at least|password is too short/i,
    human: 'La contraseña es muy corta. Probá con una de al menos 8 caracteres.',
    status: 422 },
  { re: /new password should be different|same as the old password/i,
    human: 'La contraseña nueva tiene que ser distinta a la anterior.',
    status: 422 },
  { re: /password should contain|character types/i,
    human: 'La contraseña no cumple los requisitos mínimos.',
    status: 422 },
  { re: /user already (registered|exists)|email.*already.*registered|already been registered/i,
    human: 'Ya existe un usuario con ese email.',
    status: 409 },
  { re: /invalid login credentials|invalid email or password/i,
    human: 'Email o contraseña incorrectos.',
    status: 401 },
  { re: /email address.*invalid|invalid email format/i,
    human: 'El email no tiene un formato válido.',
    status: 422 },
  { re: /signup is disabled|signups (are )?(not allowed|disabled)/i,
    human: 'El registro está deshabilitado en este momento.',
    status: 403 },
  { re: /email not confirmed/i,
    human: 'El usuario todavía no confirmó su email.',
    status: 401 },
  // ---------- Gmail API / Google ----------
  { re: /quota.*exceeded|rate.*limit.*exceeded|too many requests/i,
    human: 'Demasiadas operaciones seguidas con Google. Esperá unos minutos y reintentá.',
    status: 429 },
  { re: /invalid.*recipient|address.*invalid|no such user|user not found.*gmail/i,
    human: 'El email destinatario no es válido o no existe.',
    status: 422 },
  { re: /authentication.*failed|invalid.*token|invalid.*credentials.*gmail|oauth.*invalid/i,
    human: 'Se perdió la conexión con la casilla de email. Reconectá Google Workspace en Configuración.',
    status: 401 },
  { re: /message too large|attachment.*too large/i,
    human: 'El email o sus adjuntos son demasiado grandes para Gmail (límite 25 MB).',
    status: 413 },
  // ---------- ARCA / AFIP ----------
  { re: /no autorizado.*cuit|cuit.*no.*autorizado|certificate.*not.*valid.*arca/i,
    human: 'El CUIT no está autorizado por ARCA o el certificado venció. Revisá la configuración del emisor.',
    status: 403 },
  { re: /punto.*venta.*no.*habilitado|pos.*not.*authorized/i,
    human: 'El punto de venta no está habilitado en ARCA para este emisor.',
    status: 403 },
  { re: /cae.*ya.*existe|comprobante.*ya.*autorizado|duplicado.*arca/i,
    human: 'Este comprobante ya fue autorizado en ARCA. Refrescá para ver el CAE.',
    status: 409 },
  { re: /tiempo.*excedido|timeout.*arca|service.*unavailable.*arca/i,
    human: 'ARCA está tardando demasiado en responder. Reintentá en unos minutos.',
    status: 504 },
  { re: /web service.*no.*disponible|wsfe.*unavailable/i,
    human: 'El servicio de facturación de ARCA está caído. Reintentá más tarde.',
    status: 503 },
  // ---------- Zoom / Webex ----------
  { re: /invalid.*meeting.*id|meeting.*not.*found/i,
    human: 'No encontramos esa reunión en Zoom. Verificá el ID o creá una nueva.',
    status: 404 },
  { re: /zoom.*token.*invalid|zoom.*authentication.*failed/i,
    human: 'Se perdió la conexión con Zoom. Reconectá la cuenta en Configuración.',
    status: 401 },
  { re: /webinar.*limit.*reached|max.*webinars/i,
    human: 'Llegaste al límite de webinars de tu plan Zoom.',
    status: 429 },
  // ---------- Genéricos red / infra ----------
  { re: /network.*error|fetch.*failed|connection.*refused|econnrefused/i,
    human: 'No pudimos conectar con el servicio. Verificá tu conexión a internet y reintentá.',
    status: 503 },
  { re: /timeout|timed out/i,
    human: 'El servidor tardó demasiado en responder. Reintentá en unos segundos.',
    status: 504 },
];

/**
 * Convierte un mensaje técnico de un servicio externo a copy humano en
 * español. Si ningún patrón matchea, devuelve un fallback genérico que
 * NO incluye el mensaje técnico crudo (para no filtrar info al cliente).
 *
 * @param raw - el `error.message` del servicio externo.
 * @param fallback - copy a usar si no hay match. Default: "Hubo un
 *   problema con la operación. Reintentá en unos minutos o avisá a
 *   un gerente si persiste."
 * @returns objeto con `message` (humano) y `status` (HTTP sugerido).
 */
export function humanizeUpstream(
  raw: string | undefined | null,
  fallback?: string,
): { message: string; status: number } {
  const text = (raw ?? '').toString();
  for (const m of COMMON_MAPS) {
    if (m.re.test(text)) {
      return { message: m.human, status: m.status ?? 500 };
    }
  }
  return {
    message: fallback ?? 'Hubo un problema con la operación. Reintentá en unos minutos o avisá a un gerente si persiste.',
    status: 500,
  };
}

/**
 * Atajo: devuelve solo el string humano sin el status.
 * Útil cuando vos manejás el status code aparte.
 */
export function humanizeUpstreamMsg(raw: string | undefined | null, fallback?: string): string {
  return humanizeUpstream(raw, fallback).message;
}
