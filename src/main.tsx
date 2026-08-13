import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/contexts/AuthContext';
import { SoundProvider } from '@/contexts/SoundContext';
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext';
import { GlobalPeriodProvider } from '@/contexts/GlobalPeriodContext';
import { DialogProvider } from '@/components/common';
import { ToastViewport } from '@/components/common/ToastViewport';
import { CommandPalette } from '@/components/common/CommandPalette';
import { App } from '@/App';
import { installGlobalErrorReporter } from '@/lib/errorReport';
import '@/index.css';
// DGG-136 · tema conmutable gg-brand: inerte sin data-theme="gg-brand" en <html>
// (el atributo lo setea el script pre-paint de index.html según el flag).
import '@/styles/gg-theme.css';

// P2-#31 · Captura global de errores JS para tracking propio (DGG-38).
installGlobalErrorReporter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoundProvider>
      <AuthProvider>
        <CommandPaletteProvider>
          <GlobalPeriodProvider>
            <DialogProvider>
              <App />
              <ToastViewport />
              <CommandPalette />
            </DialogProvider>
          </GlobalPeriodProvider>
        </CommandPaletteProvider>
      </AuthProvider>
    </SoundProvider>
  </StrictMode>,
);

// Registro del service worker (PWA). En desarrollo (vite dev) o sobre
// localhost lo saltamos para no interferir con HMR.
//
// E-GG-155 · auto-update real: antes una pestaña/PWA abierta por días jamás
// re-chequeaba el SW ni se recargaba → corría un bundle viejo en RAM (p.ej.
// pre-E-GG-144: refresh de tokens sin lock → GoTrue revocaba la familia y
// deslogueaba a todos). Ahora: (1) reg.update() cada vez que la pestaña
// vuelve a estar visible; (2) cuando un SW nuevo toma control (deploy), la
// pestaña se recarga sola — al instante si está oculta, o apenas el usuario
// la oculte si está visible (jamás recargar ante sus ojos, no se pierde lo
// que esté tipeando).
if (
  'serviceWorker' in navigator &&
  window.location.protocol === 'https:' &&
  !window.location.hostname.includes('localhost')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      // updateViaCache 'none': el check de versión del sw.js jamás usa el HTTP
      // cache — no dependemos del default de headers de Vercel (§6 B#7).
      .register('/service-worker.js', { updateViaCache: 'none' })
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // §6 B#3/B#4 · Cuándo es seguro auto-recargar esta pestaña:
    //   - jamás en /restablecer (la sesión de recovery vive solo en memoria,
    //     DGG-93 — un reload la pierde y el reset queda irrecuperable);
    //   - jamás con un Drawer/Modal abierto (role="dialog"): puede haber un
    //     formulario a medio llenar que un reload silencioso destruiría.
    // Si no es seguro, queda pendiente para el próximo momento oculto y seguro.
    const puedeRecargar = () =>
      !window.location.pathname.startsWith('/restablecer') &&
      !document.querySelector('[role="dialog"]');

    // Respuesta al ping del SW nuevo (§6 B#4): "corro un bundle que sabe
    // auto-recargarse con cuidado" — así el SW no nos navega a ciegas.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'GG_SW_PING' && e.ports[0]) {
        e.ports[0].postMessage('pong');
      }
    });

    // Primera toma de control (visita inicial, sin SW previo): no recargar.
    let teniaController = !!navigator.serviceWorker.controller;
    let reloadPendiente = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!teniaController) {
        teniaController = true;
        return;
      }
      if (document.hidden && puedeRecargar()) {
        window.location.reload();
        return;
      }
      reloadPendiente = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && reloadPendiente && puedeRecargar()) {
        window.location.reload();
      }
    });
  });
}
