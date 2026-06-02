// ChunkErrorBoundary · captura errores de import dinámico y fuerza reload.
//
// Problema observado por el usuario 2026-06-02: "Hay veces que las páginas
// quedan en blanco; hay que recargarlas y entonces entran bien". Síntoma
// clásico de chunk-error tras deploy:
//
//   1. Usuario abre la app → bundle vY se descarga, los lazy() guardan
//      referencias a `/assets/X-abc123.js`.
//   2. Vercel termina un nuevo deploy → bundle vZ pisa el CDN. Los assets
//      vY (X-abc123.js) ya NO existen.
//   3. Usuario navega a una ruta lazy → dynamic import rechaza con
//      "Failed to fetch dynamically imported module" → React no tiene
//      nada que pintar → pantalla en blanco.
//
// Fix estándar: ErrorBoundary que detecta este tipo de error y hace un
// reload duro. El usuario ve un loader breve y la app vuelve a quedar
// usable con el bundle nuevo. Si el error NO es de chunk, propaga.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Render alternativo cuando hay un error que NO es de chunk. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

// Mensajes característicos de errores de chunk en distintos browsers.
const CHUNK_ERROR_PATTERNS = [
  /Loading chunk \d+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS for/i,
  /ChunkLoadError/i,
];

function isChunkErrorMessage(message: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

// Marcador para evitar bucles de reload infinitos si el reload no fixea.
const RELOAD_FLAG = 'gg.chunk.reloaded.at';
const RELOAD_COOLDOWN_MS = 10_000;

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    const isChunk = isChunkErrorMessage(error?.message ?? '');
    return { hasError: true, isChunkError: isChunk };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log básico — Sentry (si está) captura aparte.
    // eslint-disable-next-line no-console
    console.error('[ChunkErrorBoundary]', error.message, info.componentStack);
  }

  componentDidUpdate(_prev: Props, prevState: State) {
    if (this.state.hasError && this.state.isChunkError && !prevState.hasError) {
      // Evitar bucle si el reload anterior fue muy reciente
      try {
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
        if (Date.now() - last < RELOAD_COOLDOWN_MS) {
          // Reload muy reciente → algo más está mal, no recargamos en loop.
          return;
        }
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
      } catch { /* sessionStorage bloqueado */ }
      // Pequeño delay para que el mensaje se vea brevemente.
      window.setTimeout(() => window.location.reload(), 350);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.isChunkError) {
      return (
        <div className="grid min-h-screen place-items-center bg-white px-6 text-center">
          <div className="max-w-sm space-y-3">
            <p className="text-sm font-semibold text-brand-ink">
              Actualizando a la última versión…
            </p>
            <p className="text-xs text-brand-muted">
              Detectamos una versión nueva de la plataforma. Te recargamos en
              un segundo.
            </p>
          </div>
        </div>
      );
    }

    // Error que NO es de chunk: el fallback o un mensaje genérico.
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="grid min-h-screen place-items-center bg-white px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm font-semibold text-brand-ink">
            Algo no funcionó como esperábamos.
          </p>
          <p className="text-xs text-brand-muted">
            Recargá la página. Si el problema persiste, avisanos por
            WhatsApp y lo revisamos.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-cyan px-4 py-2 text-xs font-semibold text-white hover:bg-brand-cyan/90"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
