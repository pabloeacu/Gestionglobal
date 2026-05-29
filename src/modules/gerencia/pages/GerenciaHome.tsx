import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Briefcase,
  FileText,
  AlertCircle,
  Inbox,
  CalendarClock,
  Wallet,
  Handshake,
  GraduationCap,
  BarChart3,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { ProximosVencimientosWidget } from '@/modules/vencimientos';
import { MorososWidget } from '@/modules/cta_cte';
import { ProximosSeguimientosWidget } from '@/modules/gerencia/components/ProximosSeguimientosWidget';
import { NuevasSolicitudesWidget } from '@/modules/gerencia/components/NuevasSolicitudesWidget';
import { AlarmasHoyWidget } from '@/modules/gerencia/components/AlarmasHoyWidget';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getDashboardGlobal, type DashboardKpis } from '@/services/api/dashboard';
import { DashboardKpiStrip } from '@/modules/gerencia/components/DashboardKpiStrip';
import { SparklineFacturado } from '@/modules/gerencia/components/SparklineFacturado';
import { ReporteMensualBanner } from '@/components/common/ReporteMensualBanner';
// Re-uso del asistente de instalación PWA del portal: detecta browser y
// muestra instrucciones tanto en Chrome desktop/Android como en iOS Safari /
// iOS Chrome (con copy específico para abrir en Safari).
import { PortalPwaAssistant } from '@/modules/portal/components/PortalPwaAssistant';
import { ActivarPushAssistant } from '@/components/common/ActivarPushAssistant';

interface QuickItem {
  to: string;
  label: string;
  description: string;
  icon: typeof Users;
  available: boolean;
}

// Grilla completa de atajos. El sidebar tiene exactamente estos mismos items
// (menos los hubs internos), pero la home los muestra como "tarjetas
// premium" para acelerar el flujo del primer click.
const QUICK: QuickItem[] = [
  { to: '/gerencia/clientes', label: 'Clientes', description: 'Administraciones y consorcios', icon: Users, available: true },
  { to: '/gerencia/servicios', label: 'Servicios', description: 'Catálogo y tabulador de precios', icon: Briefcase, available: true },
  { to: '/gerencia/facturacion', label: 'Facturación', description: 'Comprobantes X, A, B y C con ARCA', icon: FileText, available: true },
  { to: '/gerencia/tramites', label: 'Trámites', description: 'Expedientes y solicitudes', icon: Inbox, available: true },
  { to: '/gerencia/vencimientos', label: 'Vencimientos', description: 'Matrículas, DDJJ y certificados', icon: CalendarClock, available: true },
  { to: '/gerencia/cuenta-corriente', label: 'Cuenta corriente', description: 'Saldos consolidados y extractos', icon: Wallet, available: true },
  { to: '/gerencia/recupero', label: 'Recupero', description: 'Cobranzas R1 · R2 · R3', icon: AlertCircle, available: true },
  { to: '/gerencia/partners', label: 'Partners', description: 'Convenios y rendiciones', icon: Handshake, available: true },
  { to: '/gerencia/campus', label: 'Campus', description: 'Cursos y exámenes autocorregibles', icon: GraduationCap, available: true },
  { to: '/gerencia/reportes', label: 'Reportes', description: 'Exportes PDF/Excel + importador', icon: BarChart3, available: true },
  { to: '/gerencia/configuracion', label: 'Configuración', description: 'ARCA, emails, plantillas', icon: Settings, available: true },
];

export function GerenciaHome() {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const reload = useCallback(async () => {
    const res = await getDashboardGlobal(30);
    if (res.ok) setKpis(res.data);
    setLoadingKpis(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: si entra/cambia algo relevante para los KPIs, recargamos.
  // RLS filtra por staff (regla 2). Debounce interno del hook agrupa ráfagas.
  useRealtimeRefresh(
    ['comprobantes', 'movimientos', 'tramites', 'vencimientos'],
    reload,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <p className="kicker text-brand-cyan">Inicio</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Hola{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}.
        </h1>
        <p className="mt-2 text-brand-muted">
          Todo el ecosistema en un solo panel. Elegí por dónde arrancar.
        </p>
      </header>

      {/* CTA universal: pide permiso de push con 1 click — solo aparece
          cuando el browser lo soporta y el user aún no activó. */}
      <ActivarPushAssistant />

      {/* Asistente de instalación PWA: detecta browser y muestra cómo
          instalar en Chrome (1 click), iOS Safari (3 pasos manuales) o
          iOS Chrome/Edge (instrucciones para cambiar a Safari). */}
      <PortalPwaAssistant />

      {/* P2-#25 · Banner inteligente que invita a cerrar el mes anterior */}
      <ReporteMensualBanner />

      {/* Bloque B / obs 1: alerta de solicitudes nuevas esperando atención */}
      <NuevasSolicitudesWidget />

      {/* Bloque A / obs 5: alarmas que vencen hoy o están vencidas (con
          botones de postergación rápida +3/+5/+10 días hábiles) */}
      <AlarmasHoyWidget />

      <DashboardKpiStrip data={kpis} loading={loadingKpis} />
      <SparklineFacturado
        serie={kpis?.serie_facturado ?? []}
        loading={loadingKpis}
      />

      <section>
        <p className="kicker mb-3 text-brand-muted">Atajos</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK.map(({ to, label, description, icon: Icon, available }) =>
            available ? (
              <Link
                key={to}
                to={to}
                className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.4)]"
              >
                <TrianglesAccent
                  position="top-right"
                  size={120}
                  tone="cyan"
                  density="soft"
                  className="opacity-40 transition-opacity group-hover:opacity-70"
                />
                <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
                  <Icon size={20} />
                </span>
                <div className="relative min-w-0">
                  <p className="font-display text-base font-bold text-brand-ink">
                    {label}
                  </p>
                  <p className="truncate text-xs text-brand-muted">
                    {description}
                  </p>
                </div>
              </Link>
            ) : (
              <div
                key={to}
                className="flex items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-5"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-brand-muted">
                  <Icon size={20} />
                </span>
                <div>
                  <p className="font-display text-base font-bold text-brand-muted">
                    {label}
                  </p>
                  <p className="text-xs text-brand-muted/80">
                    {description} · próximamente
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <ProximosVencimientosWidget />
        <MorososWidget limit={5} />
      </section>

      <section className="grid gap-6 lg:grid-cols-1">
        <ProximosSeguimientosWidget dias={7} limit={8} />
      </section>
    </div>
  );
}
