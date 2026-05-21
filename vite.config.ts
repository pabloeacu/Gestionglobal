import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

// Versión derivada del commit: en build leemos el SHA corto. Cuando el
// deploy es de Vercel también está disponible vía VERCEL_GIT_COMMIT_SHA.
function getAppVersion(): string {
  try {
    if (process.env.VERCEL_GIT_COMMIT_SHA) {
      return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
    }
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return sha || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173 },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(getAppVersion()),
  },
  build: {
    chunkSizeWarningLimit: 800,
    // El manualChunks de vendor-react se quitó: rompía en producción (los
    // sub-paths de React como `react/jsx-runtime` y `react-dom/client`
    // quedaban en chunks separados causando duplicación del runtime).
    // El code splitting via React.lazy() ya nos da chunks por página, que
    // es lo importante para el TTI.
  },
});
