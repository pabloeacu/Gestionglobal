// Meta Pixel (medición de Meta Ads) — DGG-242.
// Capa "tonta": SÓLO carga/inicializa el píxel y dispara eventos. El gateo por
// CONSENTIMIENTO y por RUTA PÚBLICA lo hace la capa de orquestación
// (components/site/MetaPixel.tsx + CookieConsent). Acá no se decide nada.
//
// Reglas de la misión Meta:
//  - El píxel NO carga si VITE_META_PIXEL_ID está vacía.
//  - Cada evento lleva un `event_id` (UUID) para DEDUPLICAR con la CAPI del
//    servidor (mismo event_id en navegador y servidor).
//  - NUNCA se mandan datos personales en los parámetros del navegador: los
//    helpers de eventos sólo aceptan content_name / parámetros no-PII.

const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim() || '';

let scriptLoaded = false;
let inited = false;

type Fbq = ((...args: unknown[]) => void) & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
  push?: unknown;
};
function getFbq(): Fbq | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { fbq?: Fbq }).fbq : undefined;
}

/** UUID v4 (crypto nativo con fallback). Se usa como event_id para dedup. */
export function uuidv4(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/** ¿Hay pixel configurado? (env presente). */
export function metaPixelConfigured(): boolean {
  return PIXEL_ID.length > 0;
}

export function metaPixelId(): string {
  return PIXEL_ID;
}

// Snippet oficial de Meta (fbevents.js), reescrito tipado y ejecutado una vez.
function loadScript(): void {
  if (scriptLoaded || !PIXEL_ID || typeof window === 'undefined' || typeof document === 'undefined') return;
  scriptLoaded = true;
  const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };
  if (w.fbq) return;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod.apply(n, args);
    else n.queue?.push(args);
  } as Fbq;
  n.queue = [];
  n.loaded = true;
  n.version = '2.0';
  n.push = n;
  w.fbq = n;
  w._fbq = n;
  const t = document.createElement('script');
  t.async = true;
  t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = document.getElementsByTagName('script')[0];
  s?.parentNode?.insertBefore(t, s);
}

/** Inicializa el píxel (idempotente). Sólo debe llamarse con consentimiento. */
export function initMetaPixel(): void {
  if (!PIXEL_ID || inited) return;
  loadScript();
  const fbq = getFbq();
  if (!fbq) return;
  // autoConfig=false: desactiva los EVENTOS AUTOMÁTICOS y el advanced matching
  // automático del píxel → sólo se envía lo que trackeamos explícitamente. Así,
  // aunque el script siga cargado tras un login SPA (se consintió en una página
  // pública y luego el usuario entró al portal), NO recolecta nada en rutas
  // privadas por su cuenta. (Reforzar también desde el panel de Meta.)
  fbq('set', 'autoConfig', 'false', PIXEL_ID);
  fbq('init', PIXEL_ID);
  inited = true;
}

export function metaPixelInited(): boolean {
  return inited;
}

/** PageView (SPA): se llama en cada cambio de ruta pública con consentimiento. */
export function trackPageView(): void {
  const fbq = getFbq();
  if (!inited || !fbq) return;
  fbq('track', 'PageView');
}

export type MetaStandardEvent = 'ViewContent' | 'Lead' | 'Contact' | 'CompleteRegistration';

// Sólo parámetros NO-PII (content_name, content_category, value, currency…).
export interface MetaEventParams {
  content_name?: string;
  content_category?: string;
  content_type?: string;
  value?: number;
  currency?: string;
}

/**
 * Dispara un evento estándar del píxel con un `event_id` único y lo DEVUELVE,
 * para que el llamador mande el MISMO event_id a la CAPI del servidor (dedup).
 * Si el píxel no está inicializado (sin consentimiento / sin env), igual
 * devuelve un event_id (el server-side puede seguir su camino) pero no dispara
 * nada en el navegador.
 */
export function trackMetaEvent(name: MetaStandardEvent, params: MetaEventParams = {}): string {
  const eventId = uuidv4();
  const fbq = getFbq();
  if (inited && fbq) {
    fbq('track', name, params, { eventID: eventId });
  }
  return eventId;
}

// --- cookies _fbp / _fbc (las necesita la CAPI para mejorar el matching) ---
function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

export function getFbp(): string | undefined {
  return readCookie('_fbp');
}

export function getFbc(): string | undefined {
  // _fbc lo setea el píxel a partir de ?fbclid=. Si el píxel aún no lo escribió
  // pero la URL trae fbclid, lo derivamos con el formato oficial fb.1.<ts>.<id>.
  const cookie = readCookie('_fbc');
  if (cookie) return cookie;
  try {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  } catch {
    /* noop */
  }
  return undefined;
}
