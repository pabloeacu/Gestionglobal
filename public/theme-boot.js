// DGG-136 · Boot del tema conmutable "gg-brand" (corre ANTES del primer paint).
// Archivo estático same-origin: lo cubre script-src 'self' del CSP (§6 Fase 0
// cazó que el inline no estaba en el allowlist y reportaba violation en cada
// page view). Espejo en src/lib/theme.ts — si tocás la key o los literales
// acá, tocá también allá.
//
// Activar en este dispositivo:  ?tema=gg-brand   ·   Volver:  ?tema=clasico
//
// CUTOVER GLOBAL (futuro, decisión DGG-136): cambiar DEFAULT a 'gg-brand' y
// deployar — todos los roles pasan al tema nuevo; el override por dispositivo
// sigue funcionando como herramienta de diagnóstico. Rollback = revertir esta
// línea + deploy (~2 min).
(function () {
  var DEFAULT = 'classic';
  try {
    var q = new URLSearchParams(location.search).get('tema');
    if (q === 'gg-brand') localStorage.setItem('gg.ui.theme', 'gg-brand');
    else if (q === 'clasico') localStorage.setItem('gg.ui.theme', 'classic');
    var t = localStorage.getItem('gg.ui.theme') || DEFAULT;
    if (t === 'gg-brand') {
      document.documentElement.setAttribute('data-theme', 'gg-brand');
      ['/fonts/gg-oswald-latin.woff2', '/fonts/gg-archivo-latin.woff2'].forEach(
        function (href) {
          var l = document.createElement('link');
          l.rel = 'preload';
          l.as = 'font';
          l.type = 'font/woff2';
          l.crossOrigin = '';
          l.href = href;
          document.head.appendChild(l);
        },
      );
    }
  } catch (e) {
    /* sin localStorage (privacidad extrema): queda el tema clásico */
  }
})();
