import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config de tests SEPARADA de vite.config.ts (el build de prod no la lee).
// Los tests viven en tests/ (fuera del `include` de tsconfig), así que NUNCA
// entran al `tsc --noEmit` del build de Vercel — no pueden romper el deploy.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // pool 'forks': el worker basado en threads (default) a veces no cierra el
    // proceso tras terminar en macOS/algunos runtimes → `vitest run` queda colgado
    // (colgaría el paso de CI). forks sale limpio y es determinístico.
    pool: 'forks',
  },
});
