import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { Landmark } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/common';
// DGG-146 §6 (4): lazy — GerenciaHome es eager en el router; importar el modal
// de forma directa lo metía en el chunk de entrada que descargan TODOS los
// usuarios (incluidos clientes del portal). Con lazy sólo viaja al abrirlo.
const TramixConsultaModal = lazy(() =>
  import('@/modules/portal/components/TramixConsultaModal').then((m) => ({
    default: m.TramixConsultaModal,
  })),
);
import { ProximosVencimientosWidget } from '@/modules/vencimientos';
import { MorososWidget } from '@/modules/cta_cte';
import { ProximosSeguimientosWidget } from '@/modules/gerencia/components/ProximosSeguimientosWidget';
import { NuevasSolicitudesWidget } from '@/modules/gerencia/components/NuevasSolicitudesWidget';
import { AportesGestoriaWidget } from '@/modules/gerencia/components/AportesGestoriaWidget';
import { DocsClientePendientesWidget } from '@/modules/gerencia/components/DocsClientePendientesWidget';
import { PagosInformadosWidget } from '@/modules/gerencia/components/PagosInformadosWidget';
import { EmailsRebotadosWidget } from '@/modules/gerencia/components/EmailsRebotadosWidget';
import { CertsRetenidosWidget } from '@/modules/gerencia/components/CertsRetenidosWidget';
import { ListoParaCerrarWidget } from '@/modules/gerencia/components/ListoParaCerrarWidget';
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
  // DGG-146 · acceso libre a TRAMIX desde el Inicio: consultas de potenciales
  // clientes que llaman sin trámite abierto. legajoInicial="" = formulario
  // manual directo, sin heredar el "último legajo consultado" (semántica E6).
  const [tramixOpen, setTramixOpen] = useState(false);

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
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="kicker text-brand-cyan">Inicio</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Hola{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}.
          </h1>
          <p className="mt-2 text-brand-muted">
            Todo el ecosistema en un solo panel. Elegí por dónde arrancar.
          </p>
        </div>
        {/* DGG-146 · consulta TRAMIX sin trámite: mismo botón que en el
            detalle del trámite (E6), pero con legajo a mano — caso típico:
            potencial cliente que llama a hacer una consulta. */}
        {/* DGG-146 §UI (fix Pablo 2026-08-24): `primary` (bg-brand-cyan sólido).
            El `tonal` previo usaba `bg-cyan-100` → queda FUERA del selector D.5
            del tema gg-brand (`:where(.bg-brand-cyan, …)`), así que no recibía ni
            Oswald-mayúsculas ni el hover de offset duro → se veía lavado y no como
            "nuestro botón". `primary` sí entra en D.5 y, con A.2 aplanando el
            radio, renderiza esquinas rectas + Oswald MAYÚSCULAS + cyan sólido:
            la "forma nueva" de la marca (idéntico al botón ACTIVAR). Ver
            memoria `feedback_canon_boton_marca`. */}
        <Button
          variant="primary"
          onClick={() => setTramixOpen(true)}
          title="Consultar un expediente en la Mesa de Entradas Virtual PBA (TRAMIX) — el legajo se ingresa a mano"
        >
          <Landmark className="h-4 w-4" /> Mesa de Entradas PBA
        </Button>
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

      {/* DGG-117 (caso Nogueira): emails rebotados de los últimos 7 días —
          el cliente NO recibió lo enviado; CTA a su ficha. Tono rosa. */}
      <EmailsRebotadosWidget />

      {/* DGG-119: certificados retenidos por estado de pago */}
      <CertsRetenidosWidget />

      {/* DGG-148 (pedido Pablo): banner que refuerza el aviso "Listo para cerrar"
          (mail + campanita, mig 0453) — alumnos que terminaron el curso y su
          plazo de gracia finalizó, con el trámite todavía abierto. */}
      <ListoParaCerrarWidget />

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

      {/* DGG-146 · legajoInicial="" (no undefined): formulario manual directo,
          sin heredar el último legajo consultado de otro contexto. Sólo se
          monta al abrir (chunk lazy) — inerte mientras tramixOpen=false. */}
      {tramixOpen && (
        <Suspense fallback={null}>
          <TramixConsultaModal
            open={tramixOpen}
            onClose={() => setTramixOpen(false)}
            legajoInicial=""
          />
        </Suspense>
      )}
    </div>
  );
}
