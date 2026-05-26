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
if (
  'serviceWorker' in navigator &&
  window.location.protocol === 'https:' &&
  !window.location.hostname.includes('localhost')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((err) => console.warn('SW registration failed:', err));
  });
}
