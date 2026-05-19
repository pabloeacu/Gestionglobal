import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LandingPage } from '@/modules/public/pages/LandingPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { GerenciaHome } from '@/modules/gerencia/pages/GerenciaHome';
import { PortalHome } from '@/modules/portal/pages/PortalHome';

// Redirección por rol (P-AUTH-01: route guard + RLS + RPC). Login único →
// destino según el rol del profile.
function RoleHome() {
  const { loading, user } = useAuth();
  if (loading) return <FullScreen>Cargando…</FullScreen>;
  if (!user) return <Navigate to="/ingresar" replace />;
  return user.role === 'administrador' ? (
    <Navigate to="/portal" replace />
  ) : (
    <Navigate to="/gerencia" replace />
  );
}

function Protected({
  allow,
  children,
}: {
  allow: ('gerente' | 'operador' | 'administrador')[];
  children: ReactNode;
}) {
  const { loading, user } = useAuth();
  if (loading) return <FullScreen>Cargando…</FullScreen>;
  if (!user) return <Navigate to="/ingresar" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-brand-muted">
      {children}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleHomeOrLanding />} />
        <Route path="/inicio" element={<LandingPage />} />
        <Route path="/ingresar" element={<LoginPage />} />
        <Route
          path="/gerencia/*"
          element={
            <Protected allow={['gerente', 'operador']}>
              <GerenciaHome />
            </Protected>
          }
        />
        <Route
          path="/portal/*"
          element={
            <Protected allow={['administrador']}>
              <PortalHome />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// Sin sesión muestra la landing; con sesión redirige al panel por rol.
function RoleHomeOrLanding() {
  const { loading, user } = useAuth();
  if (loading) return <FullScreen>Cargando…</FullScreen>;
  return user ? <RoleHome /> : <LandingPage />;
}
