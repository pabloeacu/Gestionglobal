// Cliente de la CAPI de Meta (server-side) — DGG-242 (PR 3/3).
// Dispara el MISMO evento que el píxel (mismo event_id → dedup) contra la edge
// function `meta-capi`, que normaliza + hashea los datos de usuario y reenvía a
// Meta. Fire-and-forget: NUNCA bloquea ni rompe el formulario. Sólo debe
// llamarse con consentimiento (el llamador lo gatea con consentGranted()).

import { getFbp, getFbc } from '@/lib/metaPixel';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
const CAPI_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/meta-capi` : '';

function normKey(k: string): string {
  return k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');
}

// Extrae em/ph/fn/ln/ct de los datos del formulario por nombres de campo comunes.
// Lo que no se encuentra se omite (la CAPI igual matchea por fbp/fbc/ip/ua).
function extractUserData(datos: Record<string, unknown>): Record<string, string> {
  const by: Record<string, string> = {};
  for (const [k, v] of Object.entries(datos)) {
    if (typeof v === 'string' && v.trim()) by[normKey(k)] = v.trim();
  }
  const pick = (names: string[]): string | undefined => names.map((n) => by[n]).find(Boolean);

  const ud: Record<string, string> = {};
  const em = pick(['email', 'correo', 'correo_electronico', 'mail', 'e_mail']);
  if (em) ud.em = em;
  const ph = pick(['telefono', 'celular', 'whatsapp', 'tel', 'telefono_celular', 'telefono_de_contacto']);
  if (ph) ud.ph = ph;
  const ct = pick(['ciudad', 'localidad']);
  if (ct) ud.ct = ct;

  const apellido = pick(['apellido', 'apellidos']);
  const nombre = pick(['nombre', 'nombres', 'nombre_completo', 'nombre_y_apellido', 'nombre_apellido']);
  if (nombre && apellido) {
    ud.fn = nombre;
    ud.ln = apellido;
  } else if (nombre) {
    const parts = nombre.split(/\s+/);
    ud.fn = parts[0] ?? nombre;
    if (parts.length > 1) ud.ln = parts.slice(1).join(' ');
  } else if (apellido) {
    ud.ln = apellido;
  }
  return ud;
}

export function sendCapiEvent(
  eventName: 'Lead' | 'CompleteRegistration',
  eventId: string,
  opts: { content_name?: string; datos?: Record<string, unknown> } = {},
): void {
  if (!CAPI_URL || !ANON) return;
  const payload = {
    event_name: eventName,
    event_id: eventId,
    event_source_url: typeof window !== 'undefined' ? window.location.href : undefined,
    action_source: 'website',
    user_data: extractUserData(opts.datos ?? {}),
    fbp: getFbp(),
    fbc: getFbc(),
    client_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    content_name: opts.content_name,
  };
  try {
    void fetch(CAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* silencioso: el formulario no depende de esto */
    });
  } catch {
    /* noop */
  }
}
