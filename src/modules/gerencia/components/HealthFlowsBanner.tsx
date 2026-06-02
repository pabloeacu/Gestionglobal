// HealthFlowsBanner · DGG-32
// Banner sticky en el layout de gerencia. Polea las alertas activas del
// health check de flujos críticos. Si hay una crítica → banner rojo arriba
// de todo el panel. Si hay warning → naranja más sutil.
//
// El usuario puede ir a Salud del sistema para ver detalle y cerrar la
// alerta manualmente. Por ahora no se puede "cerrar el banner" — solo se
// cierra cuando la alerta se resuelve (en BD).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import {
  listHealthFlowActiveAlerts,
  labelDeCheck,
  type HealthFlowActiveAlert,
} from '@/services/api/healthFlows';

const POLL_MS = 5 * 60 * 1000; // refresh cada 5 minutos

export function HealthFlowsBanner() {
  const [alerts, setAlerts] = useState<HealthFlowActiveAlert[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const res = await listHealthFlowActiveAlerts();
      if (!active) return;
      if (res.ok) setAlerts(res.data);
    }
    void load();
    const id = window.setInterval(() => { void load(); }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  if (alerts.length === 0) return null;

  const hasCritical = alerts.some((a) => a.severity === 'critical');
  const severity = hasCritical ? 'critical' : 'warning';
  const Icon = hasCritical ? AlertOctagon : AlertTriangle;

  const message =
    alerts.length === 1
      ? `${labelDeCheck(alerts[0]!.check_key)}: ${alerts[0]!.last_error ?? 'flujo afectado'}`
      : `${alerts.length} flujos del sistema con problemas`;

  return (
    <div
      role="alert"
      className={
        severity === 'critical'
          ? 'border-b border-rose-300 bg-rose-50 text-rose-900'
          : 'border-b border-amber-300 bg-amber-50 text-amber-900'
      }
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Icon size={18} className="shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">
              {severity === 'critical' ? 'Alerta crítica · ' : 'Aviso del sistema · '}
            </span>
            {message}
          </div>
        </div>
        <Link
          to="/gerencia/configuracion/salud"
          className={
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ' +
            (severity === 'critical'
              ? 'bg-rose-700 text-white hover:bg-rose-800'
              : 'bg-amber-700 text-white hover:bg-amber-800')
          }
        >
          <ShieldCheck size={12} />
          Revisar Salud
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
