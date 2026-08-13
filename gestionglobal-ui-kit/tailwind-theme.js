/* ============================================================
   Gestión Global · Extensión de theme para Tailwind
   Cómo usar (Tailwind v3): fusionar `ggTheme.extend` dentro de
   theme.extend en tu tailwind.config.js. NO reemplaza tu config;
   agrega la escala de marca con prefijo `gg-` para que conviva
   con lo existente y no pise nada.
   ============================================================ */

const ggTheme = {
  extend: {
    colors: {
      gg: {
        ink:    '#0B1F33',
        ink2:   '#122230',
        slate:  '#5D7284',
        petrol: '#159AA6',
        petrolD:'#0F7C86',
        cyan:   '#009ECA',
        blue:   '#2E6FB0',
        sky:    '#9CC7E4',
        pale:   '#E7F1F9',
        paper:  '#F3F7FB',
        line:   'rgba(11,31,51,0.14)',
        ok:     '#0E9F6E', okBg:   '#E6F6EF',
        warn:   '#C46A10', warnBg: '#FBEEDD',
        bad:    '#C22B4A', badBg:  '#FBE7EC',
        info:   '#009ECA', infoBg: '#E1F3FA',
      },
    },
    fontFamily: {
      'gg-display': ['Oswald', 'system-ui', 'sans-serif'],
      'gg-body':    ['Archivo', 'system-ui', 'sans-serif'],
    },
    letterSpacing: {
      'gg-label': '0.10em',
    },
    borderRadius: {
      'gg': '0px', // la marca NO usa esquinas redondeadas
    },
  },
};

module.exports = { ggTheme };

/* --- Plugin opcional: utilidades de chamfer (esquina biselada) ---
   Agregar en plugins: [ require('./gestionglobal-ui-kit/tailwind-theme').ggChamferPlugin ]
*/
const plugin = require('tailwindcss/plugin');
const ggChamferPlugin = plugin(function ({ addUtilities }) {
  addUtilities({
    '.gg-chamfer':   { 'clip-path': 'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)' },
    '.gg-chamfer-sm':{ 'clip-path': 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' },
    '.gg-tnum':      { 'font-variant-numeric': 'tabular-nums', 'font-feature-settings': '"tnum" 1' },
  });
});
module.exports.ggChamferPlugin = ggChamferPlugin;
