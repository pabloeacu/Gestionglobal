import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLoaderScreen } from '@/components/brand/BrandLoader';

// Críticos en el árbol inicial (landing/login/layouts) → import directo.
import { LandingPage } from '@/modules/public/pages/LandingPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { GerenciaLayout } from '@/modules/gerencia/components/GerenciaLayout';
import { GerenciaHome } from '@/modules/gerencia/pages/GerenciaHome';
import { PortalLayout } from '@/modules/portal/components/PortalLayout';
import { PortalHome } from '@/modules/portal/pages/PortalHome';

// El resto se carga bajo demanda (lazy chunks) para bajar el bundle inicial.
const AdministracionesListPage = lazy(() => import('@/modules/clientes/pages/AdministracionesListPage').then(m => ({ default: m.AdministracionesListPage })));
const AdministracionDetailPage = lazy(() => import('@/modules/clientes/pages/AdministracionDetailPage').then(m => ({ default: m.AdministracionDetailPage })));
const ComprobantesListPage = lazy(() => import('@/modules/facturacion/pages/ComprobantesListPage').then(m => ({ default: m.ComprobantesListPage })));
const ComprobanteDetailPage = lazy(() => import('@/modules/facturacion/pages/ComprobanteDetailPage').then(m => ({ default: m.ComprobanteDetailPage })));
const ConfiguracionLayout = lazy(() => import('@/modules/configuracion/components/ConfiguracionLayout').then(m => ({ default: m.ConfiguracionLayout })));
const ArcaConfigPage = lazy(() => import('@/modules/configuracion/pages/ArcaConfigPage').then(m => ({ default: m.ArcaConfigPage })));
const ArcaQueuePage = lazy(() => import('@/modules/configuracion/pages/ArcaQueuePage').then(m => ({ default: m.ArcaQueuePage })));
const TramitesListPage = lazy(() => import('@/modules/tramites/pages/TramitesListPage').then(m => ({ default: m.TramitesListPage })));
const TramitesKanbanPage = lazy(() => import('@/modules/tramites/pages/TramitesKanbanPage').then(m => ({ default: m.TramitesKanbanPage })));
const ServiciosListPage = lazy(() => import('@/modules/servicios').then(m => ({ default: m.ServiciosListPage })));
const ServicioDetailPage = lazy(() => import('@/modules/servicios').then(m => ({ default: m.ServicioDetailPage })));
const VencimientosListPage = lazy(() => import('@/modules/vencimientos').then(m => ({ default: m.VencimientosListPage })));
const VencimientosConfigPage = lazy(() => import('@/modules/vencimientos').then(m => ({ default: m.VencimientosConfigPage })));
const EmailTemplatesPage = lazy(() => import('@/modules/configuracion/pages/EmailTemplatesPage').then(m => ({ default: m.EmailTemplatesPage })));
const EmailQueuePage = lazy(() => import('@/modules/configuracion/pages/EmailQueuePage').then(m => ({ default: m.EmailQueuePage })));
const RecuperoListPage = lazy(() => import('@/modules/recupero').then(m => ({ default: m.RecuperoListPage })));
const MorososPage = lazy(() => import('@/modules/recupero').then(m => ({ default: m.MorososPage })));
const RecuperoConfigPage = lazy(() => import('@/modules/recupero').then(m => ({ default: m.RecuperoConfigPage })));
const RecuperoPlantillasPage = lazy(() => import('@/modules/recupero').then(m => ({ default: m.PlantillasPage })));
const PartnersListPage = lazy(() => import('@/modules/partners').then(m => ({ default: m.PartnersListPage })));
const PartnerDetailPage = lazy(() => import('@/modules/partners').then(m => ({ default: m.PartnerDetailPage })));
const RendicionDetailPage = lazy(() => import('@/modules/partners').then(m => ({ default: m.RendicionDetailPage })));
const CampusListPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.CampusListPage })));
const CursoEditorPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.CursoEditorPage })));
const CursoDetalleAlumnoPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.CursoDetalleAlumnoPage })));
const MisCursosPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.MisCursosPage })));
const ReportesHubPage = lazy(() => import('@/modules/reportes').then(m => ({ default: m.ReportesHubPage })));
const ImportadorPage = lazy(() => import('@/modules/reportes').then(m => ({ default: m.ImportadorPage })));
const CtaCteListPage = lazy(() => import('@/modules/cta_cte').then(m => ({ default: m.CtaCteListPage })));
const CtaCteDetailPage = lazy(() => import('@/modules/cta_cte').then(m => ({ default: m.CtaCteDetailPage })));
const PortalComprobantesPage = lazy(() => import('@/modules/portal/pages/PortalComprobantesPage').then(m => ({ default: m.PortalComprobantesPage })));
const PortalComprobanteDetailPage = lazy(() => import('@/modules/portal/pages/PortalComprobanteDetailPage').then(m => ({ default: m.PortalComprobanteDetailPage })));
const PortalCtaCtePage = lazy(() => import('@/modules/portal/pages/PortalCtaCtePage').then(m => ({ default: m.PortalCtaCtePage })));
const PortalConsorciosPage = lazy(() => import('@/modules/portal/pages/PortalConsorciosPage').then(m => ({ default: m.PortalConsorciosPage })));
const PerfilPage = lazy(() => import('@/modules/auth/pages/PerfilPage').then(m => ({ default: m.PerfilPage })));
const FormularioPublicoPage = lazy(() => import('@/modules/public/pages/FormularioPublicoPage').then(m => ({ default: m.FormularioPublicoPage })));
const FormulariosAdminListPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormulariosAdminListPage })));
const FormularioBuilderPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormularioBuilderPage })));
const FormularioVersionesPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormularioVersionesPage })));
// Ronda 5 · Flujo Maestro
const SolicitudesListPage = lazy(() => import('@/modules/solicitudes').then(m => ({ default: m.SolicitudesListPage })));
const SolicitudDetailPage = lazy(() => import('@/modules/solicitudes').then(m => ({ default: m.SolicitudDetailPage })));
const TrackingDetailPage = lazy(() => import('@/modules/trackings').then(m => ({ default: m.TrackingDetailPage })));
const AgendaPage = lazy(() => import('@/modules/agenda').then(m => ({ default: m.AgendaPage })));
const AccesoExternoPage = lazy(() => import('@/modules/acceso-externo').then(m => ({ default: m.AccesoExternoPage })));

type Role = 'gerente' | 'operador' | 'administrador';

// 7.A · redirige rutas legacy `/gerencia/tramites/:id` al TrackingDetail
// nuevo conservando el id. Cita E-GG-01.
function TramiteLegacyRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/gerencia/trackings/${id ?? ''}`} replace />;
}

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
      <Suspense fallback={<BrandLoaderScreen />}>
      <Routes>
        <Route path="/" element={<RoleHomeOrLanding />} />
        <Route path="/inicio" element={<LandingPage />} />
        <Route path="/ingresar" element={<LoginPage />} />
        <Route path="/formulario/:slug" element={<FormularioPublicoPage />} />
        <Route path="/externo/:token" element={<AccesoExternoPage />} />

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
          <Route path="solicitudes" element={<SolicitudesListPage />} />
          <Route path="solicitudes/:id" element={<SolicitudDetailPage />} />
          <Route path="tramites" element={<TramitesListPage />} />
          <Route path="tramites/kanban" element={<TramitesKanbanPage />} />
          {/* 7.A · ruta legacy `/gerencia/tramites/:id` redirige al
              TrackingDetail nuevo (cierre de ciclo, alarmas, recurrencia).
              El listado y kanban legacy quedan accesibles, pero el
              detalle siempre es el nuevo. */}
          <Route
            path="tramites/:id"
            element={<TramiteLegacyRedirect />}
          />
          <Route path="trackings/:id" element={<TrackingDetailPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          {/* Tab "Vencimientos" anidado en la Agenda (unificación temporal). */}
          <Route path="agenda/vencimientos" element={<AgendaPage initialTab="vencimientos" />} />
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
          <Route path="formularios" element={<FormulariosAdminListPage />} />
          <Route path="formularios/:id" element={<FormularioBuilderPage />} />
          <Route path="formularios/:id/versiones" element={<FormularioVersionesPage />} />
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
      </Suspense>
    </BrowserRouter>
  );
}
