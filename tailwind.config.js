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
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        float: 'float 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
