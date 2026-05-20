import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/contexts/AuthContext';
import { SoundProvider } from '@/contexts/SoundContext';
import { DialogProvider } from '@/components/common';
import { ToastViewport } from '@/components/common/ToastViewport';
import { App } from '@/App';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoundProvider>
      <AuthProvider>
        <DialogProvider>
          <App />
          <ToastViewport />
        </DialogProvider>
      </AuthProvider>
    </SoundProvider>
  </StrictMode>,
);
