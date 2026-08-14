// DGG-136 · Boot del tema conmutable "gg-brand" (corre ANTES del primer paint).
// Archivo estático same-origin: lo cubre script-src 'self' del CSP (§6 Fase 0).
// Espejo en src/lib/theme.ts — si tocás la key o los literales acá, tocá
// también allá.
//
// Activar en este dispositivo:  ?tema=gg-brand   ·   Volver:  ?tema=clasico
//
// §6 integral: (1) el DEFAULT aplica aunque localStorage esté bloqueado
// (Chrome block-all-cookies lanza al ACCEDER a window.localStorage — el
// default vive fuera del try); (2) key versionada v2: el cutover ignora y
// limpia la key vieja, liberando a cualquier dispositivo que hubiera
// probado ?tema=clasico antes del lanzamiento.
//
// CUTOVER GLOBAL: DEFAULT='gg-brand' (decisión Pablo 2026-08-14). Rollback =
// volver a 'classic' + deploy (~2 min); diagnóstico por dispositivo con
// ?tema=clasico.
(function () {
  var DEFAULT = 'classic';
  var t = DEFAULT;
  try {
    var q = new URLSearchParams(location.search).get('tema');
    if (q === 'gg-brand') localStorage.setItem('gg.ui.theme.v2', 'gg-brand');
    else if (q === 'clasico') localStorage.setItem('gg.ui.theme.v2', 'classic');
    localStorage.removeItem('gg.ui.theme'); // key pre-cutover, ya sin efecto
    t = localStorage.getItem('gg.ui.theme.v2') || DEFAULT;
  } catch (e) {
    /* sin localStorage: manda el DEFAULT */
  }
  if (t === 'gg-brand') {
    document.documentElement.setAttribute('data-theme', 'gg-brand');
    // Preloads de fuentes de marca — salvo en la landing pública, que por
    // ley queda clásica y no las usa (perf §6).
    if (location.pathname !== '/') {
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
  }
})();
