import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/contexts/AuthContext';
import { SoundProvider } from '@/contexts/SoundContext';
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext';
import { DialogProvider } from '@/components/common';
import { ToastViewport } from '@/components/common/ToastViewport';
import { CommandPalette } from '@/components/common/CommandPalette';
import { App } from '@/App';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoundProvider>
      <AuthProvider>
        <CommandPaletteProvider>
          <DialogProvider>
            <App />
            <ToastViewport />
            <CommandPalette />
          </DialogProvider>
        </CommandPaletteProvider>
      </AuthProvider>
    </SoundProvider>
  </StrictMode>,
);
