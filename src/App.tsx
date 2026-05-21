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
import { ConfiguracionLayout } from '@/modules/configuracion/components/ConfiguracionLayout';
import { ArcaConfigPage } from '@/modules/configuracion/pages/ArcaConfigPage';
import { ArcaQueuePage } from '@/modules/configuracion/pages/ArcaQueuePage';
import { TramitesListPage } from '@/modules/tramites/pages/TramitesListPage';
import { TramitesKanbanPage } from '@/modules/tramites/pages/TramitesKanbanPage';
import { TramiteDetailPage } from '@/modules/tramites/pages/TramiteDetailPage';
import { ServiciosListPage, ServicioDetailPage } from '@/modules/servicios';
import { VencimientosListPage, VencimientosConfigPage } from '@/modules/vencimientos';
import { EmailTemplatesPage } from '@/modules/configuracion/pages/EmailTemplatesPage';
import { EmailQueuePage } from '@/modules/configuracion/pages/EmailQueuePage';
import {
  RecuperoListPage,
  MorososPage,
  RecuperoConfigPage,
  PlantillasPage as RecuperoPlantillasPage,
} from '@/modules/recupero';
import {
  PartnersListPage,
  PartnerDetailPage,
  RendicionDetailPage,
} from '@/modules/partners';
import {
  CampusListPage,
  CursoEditorPage,
  CursoDetalleAlumnoPage,
  MisCursosPage,
} from '@/modules/campus';
import { ReportesHubPage, ImportadorPage } from '@/modules/reportes';
import { CtaCteListPage, CtaCteDetailPage } from '@/modules/cta_cte';
import { PortalLayout } from '@/modules/portal/components/PortalLayout';
import { PortalHome } from '@/modules/portal/pages/PortalHome';
import { PortalComprobantesPage } from '@/modules/portal/pages/PortalComprobantesPage';
import { PortalComprobanteDetailPage } from '@/modules/portal/pages/PortalComprobanteDetailPage';
import { PortalCtaCtePage } from '@/modules/portal/pages/PortalCtaCtePage';
import { PortalConsorciosPage } from '@/modules/portal/pages/PortalConsorciosPage';
import { PerfilPage } from '@/modules/auth/pages/PerfilPage';
import { FormularioPublicoPage } from '@/modules/public/pages/FormularioPublicoPage';

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
        <Route path="/formulario/:slug" element={<FormularioPublicoPage />} />

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
          <Route path="tramites" element={<TramitesListPage />} />
          <Route path="tramites/kanban" element={<TramitesKanbanPage />} />
          <Route path="tramites/:id" element={<TramiteDetailPage />} />
          <Route path="servicios" element={<ServiciosListPage />} />
          <Route path="servicios/:id" element={<ServicioDetailPage />} />
          <Route path="vencimientos" element={<VencimientosListPage />} />
          <Route path="vencimientos/configuracion" element={<VencimientosConfigPage />} />
          <Route path="cuenta-corriente" element={<CtaCteListPage />} />
          <Route path="cuenta-corriente/:adminId" element={<CtaCteDetailPage />} />
          <Route path="recupero" element={<RecuperoListPage />} />
          <Route path="recupero/morosos" element={<MorososPage />} />
          <Route path="recupero/configuracion" element={<RecuperoConfigPage />} />
          <Route path="recupero/plantillas" element={<RecuperoPlantillasPage />} />
          <Route path="partners" element={<PartnersListPage />} />
          <Route path="partners/:id" element={<PartnerDetailPage />} />
          <Route path="partners/:partnerId/rendiciones/:id" element={<RendicionDetailPage />} />
          <Route path="campus" element={<CampusListPage />} />
          <Route path="campus/:id" element={<CursoEditorPage />} />
          <Route path="reportes" element={<ReportesHubPage />} />
          <Route path="reportes/importador" element={<ImportadorPage />} />
          <Route path="configuracion" element={<ConfiguracionLayout />}>
            <Route index element={<Navigate to="arca" replace />} />
            <Route path="arca" element={<ArcaConfigPage />} />
            <Route path="arca/cola" element={<ArcaQueuePage />} />
            <Route path="emails/templates" element={<EmailTemplatesPage />} />
            <Route path="emails/cola" element={<EmailQueuePage />} />
          </Route>
          <Route path="perfil" element={<PerfilPage />} />
        </Route>

        <Route
          path="/portal"
          element={
            <Protected allow={['administrador']}>
              <PortalLayout />
            </Protected>
          }
        >
          <Route index element={<PortalHome />} />
          <Route path="comprobantes" element={<PortalComprobantesPage />} />
          <Route
            path="comprobantes/:id"
            element={<PortalComprobanteDetailPage />}
          />
          <Route path="cuenta-corriente" element={<PortalCtaCtePage />} />
          <Route path="consorcios" element={<PortalConsorciosPage />} />
          <Route path="campus" element={<MisCursosPage />} />
          <Route path="campus/:slug" element={<CursoDetalleAlumnoPage />} />
          <Route path="perfil" element={<PerfilPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
