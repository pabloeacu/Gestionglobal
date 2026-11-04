// Consentimiento de medición/publicidad (píxel de Meta) — DGG-242.
// El sitio no tenía banner de cookies: implementamos un aviso mínimo que
// CONDICIONA la carga del píxel al consentimiento (requisito de la misión).
// Persistencia en localStorage (per-navegador). Todo envuelto en try/catch:
// en modo privado / storage bloqueado el default es "sin decidir" → no carga.

export type ConsentValue = 'granted' | 'denied';
const KEY = 'gg.meta.consent.v1';

const listeners = new Set<(v: ConsentValue | null) => void>();

export function getConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: ConsentValue): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage bloqueado → el aviso reaparecerá, pero nada se rompe */
  }
  listeners.forEach((cb) => {
    try {
      cb(v);
    } catch {
      /* un listener no debe tumbar a los demás */
    }
  });
}

/** Suscribe cambios de consentimiento. Devuelve la función para desuscribir. */
export function onConsentChange(cb: (v: ConsentValue | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function consentGranted(): boolean {
  return getConsent() === 'granted';
}
