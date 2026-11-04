// Atribución de marketing (UTM + origen) — DGG-242.
// Guarda el PRIMER utm_* / origen de la sesión (first-touch) en sessionStorage,
// para mandarlos como campos ocultos de los formularios públicos sin perder
// ?origen=prospecto|portal ni los utm_*. First-touch = no se pisa si ya existe.

const KEY = 'gg.utm.firsttouch.v1';
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export type UtmData = Partial<Record<(typeof UTM_FIELDS)[number] | 'origen', string>>;

/** Captura first-touch: sólo guarda si todavía no hay datos y la URL trae algo. */
export function captureUtmFirstTouch(search: string): void {
  try {
    if (sessionStorage.getItem(KEY)) return; // ya capturado (first-touch)
    const q = new URLSearchParams(search);
    const data: UtmData = {};
    for (const f of UTM_FIELDS) {
      const v = q.get(f);
      if (v) data[f] = v.slice(0, 200);
    }
    const origen = q.get('origen');
    if (origen) data.origen = origen.slice(0, 60);
    if (Object.keys(data).length > 0) {
      sessionStorage.setItem(KEY, JSON.stringify(data));
    }
  } catch {
    /* sessionStorage no disponible → sin atribución, no se rompe nada */
  }
}

export function getUtmFirstTouch(): UtmData {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UtmData) : {};
  } catch {
    return {};
  }
}
