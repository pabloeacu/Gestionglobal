// ArcaQueuePage · panel de cola de emisión con Realtime + KPIs + retry + ver XML.
// Cita D01 (cola persistida + Realtime), AnimatedNumber para KPIs.

import { useEffect, useMemo, useState } from 'react';
import {
  Layers,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  RotateCcw,
  Eye,
  Send,
} from 'lucide-react';
import {
  AnimatedNumber,
  Modal,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  getColaKpis,
  listColaJobs,
  reintentarJob,
  type ArcaKpis,
  type ArcaQueueJobWithComp,
} from '@/services/api/arca';

type StatusFilter = 'all' | ArcaQueueJobWithComp['status'];

export function ArcaQueuePage() {
  const [kpis, setKpis] = useState<ArcaKpis>({ pending: 0, sending: 0, done: 0, failed: 0 });
  const [rows, setRows] = useState<ArcaQueueJobWithComp[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [detailJob, setDetailJob] = useState<ArcaQueueJobWithComp | null>(null);

  async function refresh() {
    const [kpisRes, listRes] = await Promise.all([
      getColaKpis(),
      listColaJobs({ status: filter === 'all' ? undefined : filter, limit: 100 }),
    ]);
    if (kpisRes.ok) setKpis(kpisRes.data);
    if (listRes.ok) setRows(listRes.data.rows);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Realtime: refrescar lista cuando cambie cualquier row de la cola.
  useEffect(() => {
    const channel = supabase
      .channel('arca-queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'arca_emision_queue' },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function handleRetry(id: string) {
    const res = await reintentarJob(id);
    if (!res.ok) {
      toast.error('No pudimos reintentar', { description: res.error.message });
      return;
    }
    toast.success('Job re-encolado · esperá el próximo dispatcher (~1 min)');
    void refresh();
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [rows]);

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      <header>
        <p className="kicker text-brand-cyan">Configuración · ARCA</p>
        <h1 className="font-display text-2xl font-bold text-brand-ink">
          Cola de emisión
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Cada autorización en vuelo. El cron procesa los jobs cada minuto · podés cerrar la pestaña, el server sigue.
        </p>
      </header>

      {/* KPI cards clickables como filtros */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total"
          value={kpis.pending + kpis.sending + kpis.done + kpis.failed}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          icon={Layers}
          tone="cyan"
        />
        <KpiCard
          label="Pendientes"
          value={kpis.pending}
          active={filter === 'pending'}
          onClick={() => setFilter('pending')}
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="En vuelo"
          value={kpis.sending}
          active={filter === 'sending'}
          onClick={() => setFilter('sending')}
          icon={Send}
          tone="cyan"
        />
        <KpiCard
          label="Autorizados"
          value={kpis.done}
          active={filter === 'done'}
          onClick={() => setFilter('done')}
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Fallidos"
          value={kpis.failed}
          active={filter === 'failed'}
          onClick={() => setFilter('failed')}
          icon={AlertCircle}
          tone="red"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-brand-zebra/40 text-left text-xs uppercase tracking-wider text-brand-muted">
            <tr>
              <th className="px-4 py-2">Comprobante</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2 text-right">Intentos</th>
              <th className="px-4 py-2">CAE</th>
              <th className="px-4 py-2">Started</th>
              <th className="px-4 py-2">Finished</th>
              <th className="px-4 py-2">Error</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-brand-muted">
                  <Loader2 className="mx-auto animate-spin" size={18} />
                </td>
              </tr>
            )}
            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-brand-muted">
                  No hay jobs {filter === 'all' ? 'en la cola' : `con estado ${filter}`}.
                </td>
              </tr>
            )}
            {sortedRows.map((j) => (
              <tr
                key={j.id}
                className="border-t border-slate-100 hover:bg-brand-zebra/30"
              >
                <td className="px-4 py-2 font-mono text-xs text-brand-ink">
                  {j.comprobante
                    ? `${j.comprobante.tipo} ${String(j.comprobante.punto_venta).padStart(5, '0')}-${j.comprobante.numero ?? '????'}`
                    : '—'}
                  {j.comprobante?.receptor_razon_social && (
                    <p className="font-sans text-[11px] text-brand-muted">
                      {j.comprobante.receptor_razon_social}
                    </p>
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={j.status} />
                </td>
                <td className="px-4 py-2 text-right tabular">
                  {j.attempt}/{j.max_attempts}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-brand-muted">
                  {j.cae ?? '—'}
                </td>
                <td className="px-4 py-2 text-xs text-brand-muted">
                  {j.started_at ? new Date(j.started_at).toLocaleString('es-AR') : '—'}
                </td>
                <td className="px-4 py-2 text-xs text-brand-muted">
                  {j.finished_at ? new Date(j.finished_at).toLocaleString('es-AR') : '—'}
                </td>
                <td className="px-4 py-2 max-w-xs">
                  <p className="truncate text-xs text-red-700">
                    {j.last_error ?? '—'}
                  </p>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {(j.request_xml || j.response_xml) && (
                      <button
                        type="button"
                        onClick={() => setDetailJob(j)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                      >
                        <Eye size={11} /> XML
                      </button>
                    )}
                    {(j.status === 'failed' || j.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => void handleRetry(j.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-2 py-1 text-xs font-medium text-white hover:bg-brand-cyan-700"
                      >
                        <RotateCcw size={11} /> Reintentar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!detailJob}
        onClose={() => setDetailJob(null)}
        title={`Job ${detailJob?.id.slice(0, 8)} · XML`}
        width={760}
      >
        {detailJob && (
          <div className="space-y-3">
            <section>
              <p className="kicker text-brand-cyan">Request</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-50 p-3 font-mono text-[10px] text-brand-ink">
                {detailJob.request_xml ?? '(sin request)'}
              </pre>
            </section>
            <section>
              <p className="kicker text-brand-cyan">Response</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-50 p-3 font-mono text-[10px] text-brand-ink">
                {detailJob.response_xml ?? '(sin response)'}
              </pre>
            </section>
            {detailJob.last_error && (
              <section>
                <p className="kicker text-red-600">Error</p>
                <p className="mt-1 rounded-md bg-red-50 p-3 text-xs text-red-800">
                  {detailJob.last_error}
                </p>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function KpiCard({
  label,
  value,
  active,
  onClick,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  icon: typeof CheckCircle2;
  tone: 'cyan' | 'amber' | 'emerald' | 'red';
}) {
  const toneClasses = {
    cyan: 'border-brand-cyan/40 text-brand-cyan',
    amber: 'border-amber-300/60 text-amber-600',
    emerald: 'border-emerald-300/60 text-emerald-600',
    red: 'border-red-300/60 text-red-600',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card-premium relative flex flex-col items-start gap-1 p-4 text-left transition',
        active ? `ring-2 ${toneClasses.replace('text-', 'ring-')}` : 'hover:border-brand-cyan/40',
      )}
    >
      <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', toneClasses)}>
        <Icon size={13} />
        {label}
      </div>
      <p className="font-display text-2xl font-bold tabular text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
    </button>
  );
}

function StatusBadge({ status }: { status: ArcaQueueJobWithComp['status'] }) {
  const map: Record<typeof status, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
    pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700', icon: Clock },
    sending: { label: 'En vuelo', cls: 'bg-brand-cyan-pale text-brand-cyan', icon: Loader2 },
    done: { label: 'Autorizado', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    failed: { label: 'Falló', cls: 'bg-red-100 text-red-700', icon: AlertCircle },
    cancelled: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-600', icon: AlertCircle },
  };
  const m = map[status];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>
      <Icon size={10} />
      {m.label}
    </span>
  );
}
