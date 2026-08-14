// DGG-136 · Flag del tema conmutable "gg-brand" (dirección visual marca-nativa).
//
// Modelo de dos niveles (decisión Pablo 2026-08-13):
//   1. Por dispositivo (AHORA): localStorage 'gg.ui.theme' — solo lo ve quien
//      lo activa. Atajos: ?tema=gg-brand / ?tema=clasico (los procesa el
//      script pre-paint de index.html antes del primer render).
//   2. Cutover global (FUTURO): cambiar DEFAULT en public/theme-boot.js a
//      'gg-brand' y deployar; el override por dispositivo sigue disponible
//      como herramienta de diagnóstico.
//
// La activación real es SOLO el atributo data-theme en <html>: todo el tema
// vive en CSS (src/styles/gg-theme.css + overrides por fase). Cero lógica.
// ESPEJO de public/theme-boot.js — si tocás la key o los literales acá,
// tocá también allá (§6 Fase 0, regla anti-divergencia).

const STORAGE_KEY = 'gg.ui.theme';

export type UiTheme = 'classic' | 'gg-brand';

export function getUiTheme(): UiTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'gg-brand') return 'gg-brand';
    if (stored === 'classic') return 'classic';
  } catch {
    /* sin localStorage → default */
  }
  // Sin flag guardado: el default lo decidió theme-boot.js antes del primer
  // paint — el atributo presente en <html> ES la fuente de verdad.
  return document.documentElement.getAttribute('data-theme') === 'gg-brand'
    ? 'gg-brand'
    : 'classic';
}

/** Persiste el flag y aplica el tema al instante (sin recargar). */
export function setUiTheme(theme: UiTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* modo privado extremo: aplica igual en esta pestaña */
  }
  applyUiTheme(theme);
}

export function applyUiTheme(theme: UiTheme = getUiTheme()): void {
  if (theme === 'gg-brand') {
    document.documentElement.setAttribute('data-theme', 'gg-brand');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
