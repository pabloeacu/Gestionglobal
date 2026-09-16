// _shared/fetchTimeout.ts · fetch con timeout (Auditoría 2026-09 · Fase C / C1 · hallazgo A4).
//
// Las integraciones externas (AFIP/ARCA, Resend, FCM, Zoom, Webex, Gmail) hacían `fetch`
// SIN timeout: un tercero colgado retiene la edge hasta el wall-clock limit de la plataforma.
// Caso peor (dispatch-arca-emission, serie con await, cron cada 1 min): una llamada AFIP
// colgada consume toda la corrida y el comprobante queda en 'sending' hasta el watchdog.
//
// Ambos helpers abortan tras `ms` y lanzan un error cuyo mensaje contiene "timeout" (así los
// clasificadores de error transitorio —p. ej. isTransientArcaError en _shared/arca.ts— lo
// tratan como reintentable). Un timeout GENEROSO sólo dispara ante un cuelgue real: es
// aditivo/inocuo para toda llamada que responde en tiempo normal. Timeouts sugeridos:
// AFIP 20s, Gmail/Resend 20s, push(FCM) 10s, Zoom/Webex 10s.

/**
 * fetch con timeout que cubre SÓLO la conexión + headers. Devuelve la Response para que el
 * caller consuma el body. Ojo: el timer se limpia al resolver fetch(), así que un cuelgue en
 * el streaming del body NO queda cubierto — usá `fetchTextConTimeout` si el body es crítico.
 */
export async function fetchConTimeout(
  url: string,
  init: RequestInit = {},
  ms = 15000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`fetch timeout tras ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * fetch con timeout que cubre la operación COMPLETA: conexión + headers + lectura del body.
 * Preferilo cuando el body importa (p. ej. SOAP de AFIP): si el tercero manda headers pero
 * cuelga el streaming del cuerpo, el timeout igual dispara. Devuelve lo esencial ya leído.
 */
export async function fetchTextConTimeout(
  url: string,
  init: RequestInit = {},
  ms = 15000,
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text(); // el body también corre bajo el mismo timeout
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`fetch timeout tras ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
