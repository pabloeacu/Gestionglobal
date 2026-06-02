// FlujosCriticosSection · DGG-32
// Bloque dentro de SaludSistemaPage que muestra el health check de flujos
// asíncronos (E-GG-26/27/28 detectores) y permite correr a demanda.
//
// 3 piezas:
//   1. Header con badge overall_status + botón "Correr ahora"
//   2. Lista de alertas activas (si las hay)
//   3. Detalle del último run + grilla de runs recientes

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Clock,
  Play,
  ShieldCheck,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useConfirm } from '@/components/common/DialogProvider';
import { humanizeError } from '@/lib/errors';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import {
  listHealthFlowRuns,
  listHealthFlowActiveAlerts,
  resolveHealthFlowAlert,
  runHealthCheckManual,
  labelDeCheck,
  type HealthFlowRun,
  type HealthFlowActiveAlert,
  type HealthFlowStatus,
  type HealthFlowOverall,
} from '@/services/api/healthFlows';

function formatTs(s: string): string {
  try {
    return new Date(s).toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function relativeTs(s: string): string {
  try {
    const d = new Date(s).getTime();
    const now = Date.now();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'hace un instante';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    return `hace ${Math.floor(diff / 86400)} días`;
  } catch {
    return s;
  }
}

function StatusBadge({ status }: { status: HealthFlowStatus | HealthFlowOverall }) {
  const config = {
    ok: { icon: CheckCircle2, label: 'OK', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    warning: { icon: AlertTriangle, label: 'Aviso', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    critical: { icon: AlertOctagon, label: 'Crítico', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    skipped: { icon: Clock, label: 'Omitido', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  }[status] ?? { icon: Clock, label: status, cls: 'bg-slate-50 text-slate-600 border-slate-200' };

  const Icon = config.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
      config.cls,
    )}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}

export function FlujosCriticosSection() {
  const confirm = useConfirm();
  const [runs, setRuns] = useState<HealthFlowRun[]>([]);
  const [alerts, setAlerts] = useState<HealthFlowActiveAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [runsRes, alertsRes] = await Promise.all([
      listHealthFlowRuns(20),
      listHealthFlowActiveAlerts(),
    ]);
    setLoading(false);
    if (!runsRes.ok) {
      setError(humanizeError(runsRes.error));
      return;
    }
    if (!alertsRes.ok) {
      setError(humanizeError(alertsRes.error));
      return;
    }
    setRuns(runsRes.data);
    setAlerts(alertsRes.data);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // expandir por default el run más reciente
  useEffect(() => {
    if (runs.length > 0 && expandedRunId === null) {
      setExpandedRunId(runs[0]!.id);
    }
  }, [runs, expandedRunId]);

  async function handleRunNow() {
    setRunning(true);
    const res = await runHealthCheckManual();
    setRunning(false);
    if (!res.ok) {
      toast.error('No pudimos correr el chequeo', {
        description: humanizeError(res.error),
      });
      return;
    }
    const summary =
      res.data.overall_status === 'ok'
        ? 'Todos los flujos OK'
        : res.data.overall_status === 'warning'
        ? 'Hay avisos — revisá los detalles'
        : 'Hay alertas críticas — revisá los detalles';
    toast.success(`Chequeo completado en ${res.data.duration_ms}ms`, {
      description: summary,
    });
    void load();
  }

  async function handleResolve(alertId: string, checkKey: string) {
    const ok = await confirm({
      title: `Marcar "${labelDeCheck(checkKey)}" como resuelta?`,
      message:
        'La alerta volverá a abrirse automáticamente si el próximo chequeo detecta el mismo problema.',
      confirmLabel: 'Marcar resuelta',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    const res = await resolveHealthFlowAlert(alertId);
    if (!res.ok) {
      toast.error('No pudimos cerrar la alerta', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Alerta marcada como resuelta');
    void load();
  }

  const lastRun = runs[0] ?? null;

  return (
    <section className="card-premium relative overflow-hidden">
      <TrianglesAccent
        position="top-right"
        size={160}
        tone="cyan"
        density="soft"
        className="opacity-20"
      />
      <div className="relative space-y-4 p-5">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-brand-cyan" />
              <h2 className="font-display text-lg font-bold text-brand-ink">
                Flujos críticos asíncronos
              </h2>
              {lastRun && <StatusBadge status={lastRun.overall_status} />}
            </div>
            <p className="mt-1 text-xs text-brand-muted">
              Cron 00:00 y 12:00 ART · ejercita captación, dispatchers de cola,
              alineación de secretos y escala campanita→push.
              {lastRun && (
                <>
                  {' '}Último: <span className="font-medium text-brand-ink">{relativeTs(lastRun.run_at)}</span>.
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => void handleRunNow()}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-60"
          >
            {running ? (
              <RotateCcw size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {running ? 'Corriendo…' : 'Correr ahora'}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Alertas activas */}
        {alerts.length > 0 && (
          <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
              Alertas activas ({alerts.length})
            </p>
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.severity} />
                    <span className="text-sm font-semibold text-brand-ink">
                      {labelDeCheck(a.check_key)}
                    </span>
                  </div>
                  {a.last_error && (
                    <p className="text-xs text-brand-muted">{a.last_error}</p>
                  )}
                  <p className="text-[10px] text-brand-muted">
                    Detectado {relativeTs(a.started_at)} ·
                    confirmado por última vez {relativeTs(a.last_seen_at)}
                  </p>
                </div>
                <button
                  onClick={() => void handleResolve(a.id, a.check_key)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  <X size={12} /> Marcar resuelta
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Últimos runs */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Últimas 20 corridas
          </p>
          {loading && runs.length === 0 ? (
            <p className="text-sm text-brand-muted">Cargando…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-brand-muted">
              Sin corridas registradas. La primera saldrá automáticamente esta noche a las 00:00 ART.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {runs.map((run) => {
                const isOpen = expandedRunId === run.id;
                const checkCount = Object.keys(run.checks).length;
                const failedCount = Object.values(run.checks).filter(
                  (c) => c.status === 'warning' || c.status === 'critical',
                ).length;
                return (
                  <div key={run.id} className="hover:bg-brand-zebra/30">
                    <button
                      onClick={() => setExpandedRunId(isOpen ? null : run.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={run.overall_status} />
                        <span className="text-sm font-medium text-brand-ink">
                          {formatTs(run.run_at)}
                        </span>
                        <span className="text-xs text-brand-muted">
                          · {run.origen === 'manual' ? 'manual' : 'cron'} · {run.duration_ms}ms
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-brand-muted">
                        <span>
                          {failedCount > 0
                            ? `${failedCount}/${checkCount} con problemas`
                            : `${checkCount} OK`}
                        </span>
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                        {Object.entries(run.checks).map(([key, check]) => (
                          <div
                            key={key}
                            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5"
                          >
                            <div className="mt-0.5 shrink-0">
                              <StatusBadge status={check.status} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-brand-ink">
                                {labelDeCheck(key)}
                              </p>
                              <p className="break-words text-[11px] text-brand-muted">
                                {check.detail}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
