import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LandingPage } from '@/modules/public/pages/LandingPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { GerenciaLayout } from '@/modules/gerencia/components/GerenciaLayout';
import { GerenciaHome } from '@/modules/gerencia/pages/GerenciaHome';
import { AdministracionesListPage } from '@/modules/clientes/pages/AdministracionesListPage';
import { AdministracionDetailPage } from '@/modules/clientes/pages/AdministracionDetailPage';
import { PortalHome } from '@/modules/portal/pages/PortalHome';

type Role = 'gerente' | 'operador' | 'administrador';

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-brand-muted">
      {children}
    </div>
  );
}

// Redirección por rol (P-AUTH-01). Sin sesión → landing pública.
function RoleHomeOrLanding() {
  const { loading, user, profileMissing } = useAuth();
  if (loading) return <FullScreen>Cargando…</FullScreen>;
  if (!user) {
    if (profileMissing) {
      return (
        <FullScreen>
          <div className="space-y-2 text-center">
            <p className="font-semibold text-brand-ink">No encontramos tu perfil.</p>
            <p>
              Hablá con un gerente para que active tu acceso. Mientras tanto,
              podés{' '}
              <button
                onClick={() => location.reload()}
                className="underline hover:text-brand-cyan"
              >
                reintentar
              </button>
              .
            </p>
          </div>
        </FullScreen>
      );
    }
    return <LandingPage />;
  }
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
  allow: Role[];
  children: ReactNode;
}) {
  const { loading, user } = useAuth();
  if (loading) return <FullScreen>Cargando…</FullScreen>;
  if (!user) return <Navigate to="/ingresar" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleHomeOrLanding />} />
        <Route path="/inicio" element={<LandingPage />} />
        <Route path="/ingresar" element={<LoginPage />} />

        <Route
          path="/gerencia"
          element={
            <Protected allow={['gerente', 'operador']}>
              <GerenciaLayout />
            </Protected>
          }
        >
          <Route index element={<GerenciaHome />} />
          <Route path="clientes" element={<AdministracionesListPage />} />
          <Route path="clientes/:id" element={<AdministracionDetailPage />} />
        </Route>

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
