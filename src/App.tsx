import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLoaderScreen } from '@/components/brand/BrandLoader';

// Críticos en el árbol inicial (landing/login/layouts) → import directo.
import { LandingPage } from '@/modules/public/pages/LandingPage';
import { ComingSoonCoverPage } from '@/modules/public/pages/ComingSoonCoverPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { HealthPage } from '@/modules/public/pages/HealthPage';
import { GerenciaLayout } from '@/modules/gerencia/components/GerenciaLayout';
import { GerenciaHome } from '@/modules/gerencia/pages/GerenciaHome';
import { PortalLayout } from '@/modules/portal/components/PortalLayout';
import { PortalHome } from '@/modules/portal/pages/PortalHome';
import { getLandingCoverStatus } from '@/services/api/configGlobal';

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
const UsuariosPage = lazy(() => import('@/modules/configuracion/pages/UsuariosPage').then(m => ({ default: m.UsuariosPage })));
const GeneracionCjPage = lazy(() => import('@/modules/configuracion/pages/GeneracionCjPage').then(m => ({ default: m.GeneracionCjPage })));
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
const VerificarCertificadoPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.VerificarCertificadoPage })));
const CertificadoSandboxPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.CertificadoSandboxPage })));
const CertificadoPlantillasPage = lazy(() => import('@/modules/campus').then(m => ({ default: m.CertificadoPlantillasPage })));
const ReportesHubPage = lazy(() => import('@/modules/reportes').then(m => ({ default: m.ReportesHubPage })));
const ImportadorPage = lazy(() => import('@/modules/reportes').then(m => ({ default: m.ImportadorPage })));
const CtaCteListPage = lazy(() => import('@/modules/cta_cte').then(m => ({ default: m.CtaCteListPage })));
const CtaCteDetailPage = lazy(() => import('@/modules/cta_cte').then(m => ({ default: m.CtaCteDetailPage })));
const PortalComprobantesPage = lazy(() => import('@/modules/portal/pages/PortalComprobantesPage').then(m => ({ default: m.PortalComprobantesPage })));
const PortalComprobanteDetailPage = lazy(() => import('@/modules/portal/pages/PortalComprobanteDetailPage').then(m => ({ default: m.PortalComprobanteDetailPage })));
const PortalCtaCtePage = lazy(() => import('@/modules/portal/pages/PortalCtaCtePage').then(m => ({ default: m.PortalCtaCtePage })));
const PortalConsorciosPage = lazy(() => import('@/modules/portal/pages/PortalConsorciosPage').then(m => ({ default: m.PortalConsorciosPage })));
const PortalGestionesPage = lazy(() => import('@/modules/portal/pages/PortalGestionesPage').then(m => ({ default: m.PortalGestionesPage })));
const PortalGestionDetailPage = lazy(() => import('@/modules/portal/pages/PortalGestionDetailPage').then(m => ({ default: m.PortalGestionDetailPage })));
const PortalWebinarsPage = lazy(() => import('@/modules/portal/pages/PortalWebinarsPage').then(m => ({ default: m.PortalWebinarsPage })));
const PortalNuevoServicioPage = lazy(() => import('@/modules/portal/pages/PortalNuevoServicioPage').then(m => ({ default: m.PortalNuevoServicioPage })));
const PortalMiCuentaPage = lazy(() => import('@/modules/portal/pages/PortalMiCuentaPage').then(m => ({ default: m.PortalMiCuentaPage })));
const PerfilPage = lazy(() => import('@/modules/auth/pages/PerfilPage').then(m => ({ default: m.PerfilPage })));
const FormularioPublicoPage = lazy(() => import('@/modules/public/pages/FormularioPublicoPage').then(m => ({ default: m.FormularioPublicoPage })));
const FormulariosAdminListPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormulariosAdminListPage })));
const FormularioBuilderPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormularioBuilderPage })));
const FormularioVersionesPage = lazy(() => import('@/modules/formularios-admin').then(m => ({ default: m.FormularioVersionesPage })));
const FinanzasDashboardPage = lazy(() => import('@/modules/finanzas').then(m => ({ default: m.FinanzasDashboardPage })));
const ConciliacionPage = lazy(() => import('@/modules/finanzas').then(m => ({ default: m.ConciliacionPage })));
const FinanzasAdminPage = lazy(() => import('@/modules/finanzas').then(m => ({ default: m.FinanzasAdminPage })));
const FinanzasReportesPage = lazy(() => import('@/modules/finanzas').then(m => ({ default: m.FinanzasReportesPage })));
const FinanzasImportarPage = lazy(() => import('@/modules/finanzas').then(m => ({ default: m.FinanzasImportarPage })));
const WebinarsListPage = lazy(() => import('@/modules/webinars-admin').then(m => ({ default: m.WebinarsListPage })));
const WebinarDetailPage = lazy(() => import('@/modules/webinars-admin').then(m => ({ default: m.WebinarDetailPage })));
const ProspectosListPage = lazy(() => import('@/modules/webinars-admin').then(m => ({ default: m.ProspectosListPage })));
const WebinarPublicoPage = lazy(() => import('@/modules/webinars-publico/WebinarPublicoPage').then(m => ({ default: m.WebinarPublicoPage })));
// Ronda 5 · Flujo Maestro
const SolicitudesListPage = lazy(() => import('@/modules/solicitudes').then(m => ({ default: m.SolicitudesListPage })));
const SolicitudDetailPage = lazy(() => import('@/modules/solicitudes').then(m => ({ default: m.SolicitudDetailPage })));
const TrackingDetailPage = lazy(() => import('@/modules/trackings').then(m => ({ default: m.TrackingDetailPage })));
const AgendaPage = lazy(() => import('@/modules/agenda').then(m => ({ default: m.AgendaPage })));
const AccesoExternoPage = lazy(() => import('@/modules/acceso-externo').then(m => ({ default: m.AccesoExternoPage })));
const PartnerPortalPage = lazy(() => import('@/modules/partner-portal/pages/PartnerPortalPage').then(m => ({ default: m.PartnerPortalPage })));
const AuditoriaPage = lazy(() => import('@/modules/auditoria').then(m => ({ default: m.AuditoriaPage })));
const ErroresRuntimePage = lazy(() => import('@/modules/errores').then(m => ({ default: m.ErroresRuntimePage })));
const AnaliticaPage = lazy(() => import('@/modules/analitica').then(m => ({ default: m.AnaliticaPage })));
const ComunicacionesPage = lazy(() => import('@/modules/comunicaciones').then(m => ({ default: m.ComunicacionesPage })));

type Role = 'gerente' | 'operador' | 'administrador' | 'partner';

// 7.A · redirige rutas legacy `/gerencia/tramites/:id` al TrackingDetail
// nuevo conservando el id. Cita E-GG-01.
function TramiteLegacyRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/gerencia/trackings/${id ?? ''}`} replace />;
}

// Redirección por rol (P-AUTH-01). Sin sesión → landing pública.
function RoleHomeOrLanding() {
  const { loading, user, session, profileMissing } = useAuth();
  // DGG-27 · cortina pre-lanzamiento. Sólo se evalúa cuando el visitante es
  // anónimo (sin sesión). Los usuarios logueados bypassean siempre.
  //
  // FIX flash (E-GG-23 + E-GG-24): el bug real estaba en el useEffect, que durante
  // `loading=true` hacía `setCoverEnabled(false)`. Entre que `loading` pasaba a
  // false y la RPC `get_landing_cover_status` respondía (≈200 ms), el render
  // intermedio era `coverEnabled=false + !user` → LandingPage. ESE era el flash.
  //
  // Solución: mientras `loading=true`, no tocamos `coverEnabled` (queda en `true`
  // por default optimista o el último valor cacheado). Y para visitantes
  // anónimos saltamos el BrandLoaderScreen (blanco) y vamos directo a la cortina,
  // evitando el "fade" blanco→oscuro entre loader y cortina.
  const [coverEnabled, setCoverEnabled] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('gg.cover.enabled');
      if (cached === 'true' || cached === 'false') return cached === 'true';
    } catch {/* ignore */}
    return true; // optimista: cubierto hasta confirmar
  });
  useEffect(() => {
    // Mientras auth carga, no tocamos coverEnabled (E-GG-24).
    if (loading) return;
    // Logueado: la cortina no aplica. Lo seteamos a false por las dudas
    // (aunque el render con `user` redirige a /gerencia o /portal y nunca
    // pasa por la rama de la cortina).
    if (session) {
      setCoverEnabled(false);
      return;
    }
    // Anónimo: traemos el valor real desde BD y refrescamos caché.
    let cancelled = false;
    void getLandingCoverStatus().then((v) => {
      if (cancelled) return;
      setCoverEnabled(v);
      try { localStorage.setItem('gg.cover.enabled', String(v)); } catch {/* ignore */}
    });
    return () => { cancelled = true; };
  }, [loading, session]);

  // Ocultamos el splash inline de index.html una vez que React decidió qué
  // mostrar. Si la decisión es "cortina", el splash y la cortina son visual-
  // mente idénticos, así que el reemplazo es invisible (no flash).
  useEffect(() => {
    if (!loading) {
      document.documentElement.setAttribute('data-app-ready', '1');
    }
  }, [loading]);

  if (loading) {
    // Para anónimos (sin sesión guardada), no tiene sentido mostrar el loader
    // blanco — ya sabemos qué vamos a renderizar (cortina o landing según
    // coverEnabled). Esto elimina la transición blanco→oscuro percibida como
    // "flash". Logueados sí ven el loader hasta que resuelva el profile.
    if (!session) {
      return coverEnabled ? <ComingSoonCoverPage /> : <LandingPage />;
    }
    return <BrandLoaderScreen />;
  }
  if (!user) {
    // Hay sesión activa pero el profile todavía no resolvió: estamos
    // completando el login. Mostrar el loader, NO la landing (evita el
    // flash de landing post-login). Sólo cae a landing si no hay sesión.
    if (session && !profileMissing) return <BrandLoaderScreen />;
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
    // `coverEnabled` arranca con `true` (default optimista) o el último valor
    // conocido en localStorage. El primer render YA muestra la cortina, sin
    // pasar por loader blanco intermedio.
    if (coverEnabled) return <ComingSoonCoverPage />;
    return <LandingPage />;
  }
  if (user.role === 'administrador') return <Navigate to="/portal" replace />;
  if (user.role === 'partner') return <Navigate to="/partner" replace />;
  return <Navigate to="/gerencia" replace />;
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
  // E-GG-24 follow-up: el splash de index.html sólo se ocultaba cuando
  // RoleHomeOrLanding montaba (rutas `/` y `/inicio`). Si el usuario entra
  // por `/ingresar`, `/portal`, etc., el splash quedaba pegado. Acá
  // universalizamos el signal: en cuanto React monta el App, marcamos
  // ready. El splash transiciona out con 220ms y se quita del DOM.
  useEffect(() => {
    document.documentElement.setAttribute('data-app-ready', '1');
    // PWA heartbeat: si la app corre en display-mode standalone (PWA instalada),
    // reportamos al backend para telemetría del panel Configuración → Usuarios.
    try {
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        // iOS Safari legacy
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isStandalone) {
        void import('@/services/api/usuarios').then(({ reportarPwa }) => reportarPwa(true));
      }
    } catch {
      // no crítico
    }
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<BrandLoaderScreen />}>
      <Routes>
        <Route path="/" element={<RoleHomeOrLanding />} />
        {/* `/inicio` también usa el mismo guard que `/` (cortina vs landing). */}
        <Route path="/inicio" element={<RoleHomeOrLanding />} />
        <Route path="/ingresar" element={<LoginPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/formulario/:slug" element={<FormularioPublicoPage />} />
        <Route path="/externo/:token" element={<AccesoExternoPage />} />
        <Route
          path="/partner"
          element={
            <Protected allow={['partner']}>
              <PartnerPortalPage />
            </Protected>
          }
        />
        <Route path="/verificar/:codigo" element={<VerificarCertificadoPage />} />
        <Route path="/webinar/:token" element={<WebinarPublicoPage />} />

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
          <Route path="formularios/webinars" element={<WebinarsListPage />} />
          <Route path="formularios/webinars/:id" element={<WebinarDetailPage />} />
          <Route path="formularios/prospectos" element={<ProspectosListPage />} />
          <Route path="formularios/:id" element={<FormularioBuilderPage />} />
          <Route path="formularios/:id/versiones" element={<FormularioVersionesPage />} />
          <Route path="finanzas" element={<FinanzasDashboardPage />} />
          <Route path="finanzas/conciliacion" element={<ConciliacionPage />} />
          <Route path="finanzas/admin" element={<FinanzasAdminPage />} />
          <Route path="finanzas/reportes" element={<FinanzasReportesPage />} />
          <Route path="finanzas/importar" element={<FinanzasImportarPage />} />
          <Route path="campus" element={<CampusListPage />} />
          <Route path="campus/sandbox" element={<CertificadoSandboxPage />} />
          <Route path="campus/plantillas" element={<CertificadoPlantillasPage />} />
          <Route path="campus/:id" element={<CursoEditorPage />} />
          <Route path="reportes" element={<ReportesHubPage />} />
          <Route path="reportes/importador" element={<ImportadorPage />} />
          <Route path="analitica" element={<AnaliticaPage />} />
          <Route path="comunicaciones" element={<ComunicacionesPage />} />
          <Route path="configuracion" element={<ConfiguracionLayout />}>
            <Route index element={<Navigate to="arca" replace />} />
            <Route path="arca" element={<ArcaConfigPage />} />
            <Route path="arca/cola" element={<ArcaQueuePage />} />
            <Route path="emails/templates" element={<EmailTemplatesPage />} />
            <Route path="usuarios" element={<UsuariosPage />} />
            <Route path="generacion-cj" element={<GeneracionCjPage />} />
            <Route path="emails/cola" element={<EmailQueuePage />} />
            <Route path="auditoria" element={<AuditoriaPage />} />
            <Route path="errores" element={<ErroresRuntimePage />} />
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
          <Route path="gestiones" element={<PortalGestionesPage />} />
          <Route path="gestiones/:id" element={<PortalGestionDetailPage />} />
          <Route path="webinars" element={<PortalWebinarsPage />} />
          <Route path="nuevo" element={<PortalNuevoServicioPage />} />
          <Route path="comprobantes" element={<PortalComprobantesPage />} />
          <Route
            path="comprobantes/:id"
            element={<PortalComprobanteDetailPage />}
          />
          <Route path="cuenta-corriente" element={<PortalCtaCtePage />} />
          <Route path="mi-cuenta" element={<PortalMiCuentaPage />} />
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
