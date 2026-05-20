import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLoaderScreen } from '@/components/brand/BrandLoader';
import { LandingPage } from '@/modules/public/pages/LandingPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { GerenciaLayout } from '@/modules/gerencia/components/GerenciaLayout';
import { GerenciaHome } from '@/modules/gerencia/pages/GerenciaHome';
import { AdministracionesListPage } from '@/modules/clientes/pages/AdministracionesListPage';
import { AdministracionDetailPage } from '@/modules/clientes/pages/AdministracionDetailPage';
import { ComprobantesListPage } from '@/modules/facturacion/pages/ComprobantesListPage';
import { ComprobanteDetailPage } from '@/modules/facturacion/pages/ComprobanteDetailPage';
import { PortalHome } from '@/modules/portal/pages/PortalHome';

type Role = 'gerente' | 'operador' | 'administrador';

// Redirección por rol (P-AUTH-01). Sin sesión → landing pública.
function RoleHomeOrLanding() {
  const { loading, user, profileMissing } = useAuth();
  if (loading) return <BrandLoaderScreen />;
  if (!user) {
    if (profileMissing) {
      return (
        <div className="grid min-h-screen place-items-center bg-white px-6 text-center">
          <div className="max-w-sm space-y-3">
            <p className="font-display text-xl font-bold text-brand-ink">
              No encontramos tu perfil.
            </p>
            <p className="text-sm text-brand-muted">
              Hablá con un gerente para activar tu acceso. Si recién te
              registraste, podés{' '}
              <button
                onClick={() => location.reload()}
                className="font-medium text-brand-cyan underline-offset-2 hover:underline"
              >
                reintentar
              </button>
              .
            </p>
          </div>
        </div>
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
  if (loading) return <BrandLoaderScreen />;
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
          <Route path="facturacion" element={<ComprobantesListPage />} />
          <Route path="facturacion/:id" element={<ComprobanteDetailPage />} />
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
