/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidad Gestión Global (paleta de la Presentación, alineada a doc 04 BRAND)
        // DGG-136: los valores viven como variables RGB en src/index.css (:root)
        // con EXACTAMENTE los hex históricos — así el tema conmutable gg-brand
        // puede re-tematizar TODAS las utilities compiladas redefiniendo las
        // variables bajo [data-theme="gg-brand"], sin tocar ninguna clase.
        // <alpha-value> preserva los modificadores de opacidad (bg-brand-ink/55).
        brand: {
          cyan: 'rgb(var(--brand-cyan-rgb) / <alpha-value>)',
          'cyan-light': 'rgb(var(--brand-cyan-light-rgb) / <alpha-value>)',
          'cyan-pale': 'rgb(var(--brand-cyan-pale-rgb) / <alpha-value>)',
          blue: 'rgb(var(--brand-blue-rgb) / <alpha-value>)',
          'blue-deep': 'rgb(var(--brand-blue-deep-rgb) / <alpha-value>)',
          teal: 'rgb(var(--brand-teal-rgb) / <alpha-value>)',
          orange: 'rgb(var(--brand-orange-rgb) / <alpha-value>)',
          ink: 'rgb(var(--brand-ink-rgb) / <alpha-value>)',
          night: 'rgb(var(--brand-night-rgb) / <alpha-value>)',
          'night-2': 'rgb(var(--brand-night-2-rgb) / <alpha-value>)',
          muted: 'rgb(var(--brand-muted-rgb) / <alpha-value>)',
          zebra: 'rgb(var(--brand-zebra-rgb) / <alpha-value>)',
        },
        // DGG-136 · escala gg-* del kit de marca (gestionglobal-ui-kit/tailwind-theme.js,
        // fusionado acá porque el config es ESM y el kit CJS). Solo genera utilities
        // cuando se usan en markup — inerte hasta las fases de aplicación.
        gg: {
          ink: '#0B1F33',
          ink2: '#122230',
          slate: '#5D7284',
          petrol: '#159AA6',
          petrolD: '#0F7C86',
          cyan: '#009ECA',
          blue: '#2E6FB0',
          sky: '#9CC7E4',
          pale: '#E7F1F9',
          paper: '#F3F7FB',
          line: 'rgba(11,31,51,0.14)',
          ok: '#0E9F6E',
          okBg: '#E6F6EF',
          warn: '#C46A10',
          warnBg: '#FBEEDD',
          bad: '#C22B4A',
          badBg: '#FBE7EC',
          info: '#009ECA',
          infoBg: '#E1F3FA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
        // DGG-136 · tipografías de la dirección marca-nativa (self-host en public/fonts)
        'gg-display': ['GG Oswald', 'system-ui', 'sans-serif'],
        'gg-body': ['GG Archivo', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'gg-label': '0.10em',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        breath: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.92' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(0.95)' },
          '50%': { opacity: '0.7', transform: 'scale(1.15)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'spring-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '70%': { opacity: '1', transform: 'translateY(-2px) scale(1.01)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'route-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'tooltip-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
        float: 'float 7s ease-in-out infinite',
        breath: 'breath 2.4s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        'spring-in': 'spring-in 0.42s cubic-bezier(0.34,1.56,0.64,1) both',
        'slide-in-right': 'slide-in-right 0.36s cubic-bezier(0.16,1,0.3,1) both',
        'route-in': 'route-in 0.28s cubic-bezier(0.16,1,0.3,1) both',
        'tooltip-in': 'tooltip-in 0.18s cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  // DGG-136 §6: el chamfer vive en UNA sola fuente (src/styles/gg-theme.css,
  // scopeado a [data-theme="gg-brand"]) — sin plugin duplicado acá.
  plugins: [],
};
