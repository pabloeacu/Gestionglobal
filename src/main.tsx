import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { DialogProvider } from '@/components/common';
import { App } from '@/App';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <DialogProvider>
        <App />
        <Toaster richColors position="top-right" />
      </DialogProvider>
    </AuthProvider>
  </StrictMode>,
);
