/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidad Gestión Global (paleta de la Presentación, alineada a doc 04 BRAND)
        brand: {
          cyan: '#009eca',
          'cyan-light': '#7fc3dc',
          'cyan-pale': '#a9d4e5',
          blue: '#0073b7',
          'blue-deep': '#1d4ed8',
          teal: '#1b9da8',
          orange: '#ff8200',
          ink: '#122230',
          night: '#0b1f33',
          'night-2': '#0e2a45',
          muted: '#5d7284',
          zebra: '#f7fafc',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
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
  plugins: [],
};
