import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ProximosVencimientosWidget } from '@/modules/vencimientos';
import { MorososWidget } from '@/modules/cta_cte';
import { ProximosSeguimientosWidget } from '@/modules/gerencia/components/ProximosSeguimientosWidget';
import { NuevasSolicitudesWidget } from '@/modules/gerencia/components/NuevasSolicitudesWidget';
import { AportesGestoriaWidget } from '@/modules/gerencia/components/AportesGestoriaWidget';
import { DocsClientePendientesWidget } from '@/modules/gerencia/components/DocsClientePendientesWidget';
import { PagosInformadosWidget } from '@/modules/gerencia/components/PagosInformadosWidget';
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
import { PrimerosMinutos } from '@/modules/gerencia/components/PrimerosMinutos';

// Nota: el bloque "Atajos" se removió (2026-06-02). El sidebar duplicaba
// la misma navegación — el feedback del usuario fue acortar el dashboard.
//
// Si en el futuro hace falta reintroducirlo, considerar mostrar SOLO los
// destinos personalizados al rol (no la lista entera).

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

      {/* F7 (Lista JL · DGG-62): banner de solicitudes nuevas EN TIEMPO REAL,
          arriba de todo para que el gerente no se lo pierda. Slim si no hay nada. */}
      <NuevasSolicitudesWidget />

      {/* E-GG-91 (reporte JL): aportes de la gestoría externa pendientes de
          moderación — antes sólo se veían en la campanita o dentro del trámite. */}
      <AportesGestoriaWidget />

      {/* #4 (reporte JL docx2): doc del cliente esperando revisión — antes sólo
          en la campanita/trámite, no en el Inicio. Espejo del de gestoría. */}
      <DocsClientePendientesWidget />

      {/* E-GG-116 · P5-A (reporte JL wave 6): pagos que el cliente informó,
          pendientes de conciliar — antes sólo en la campanita. Tono ámbar. */}
      <PagosInformadosWidget />

      {/* J1 · checklist "Primeros 5 minutos" para nuevos gerentes.
          Auto-oculto cuando se completa o el user lo descarta. */}
      <PrimerosMinutos />

      {/* CTA universal: pide permiso de push con 1 click — solo aparece
          cuando el browser lo soporta y el user aún no activó. */}
      <ActivarPushAssistant />

      {/* Asistente de instalación PWA: detecta browser y muestra cómo
          instalar en Chrome (1 click), iOS Safari (3 pasos manuales) o
          iOS Chrome/Edge (instrucciones para cambiar a Safari). */}
      <PortalPwaAssistant />

      {/* P2-#25 · Banner inteligente que invita a cerrar el mes anterior */}
      <ReporteMensualBanner />

      {/* Bloque A / obs 5: alarmas que vencen hoy o están vencidas (con
          botones de postergación rápida +3/+5/+10 días hábiles) */}
      <AlarmasHoyWidget />

      <DashboardKpiStrip data={kpis} loading={loadingKpis} />
      <SparklineFacturado
        serie={kpis?.serie_facturado ?? []}
        loading={loadingKpis}
      />

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
