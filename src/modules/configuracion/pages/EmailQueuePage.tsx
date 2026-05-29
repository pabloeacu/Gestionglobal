// EmailQueuePage · cola de emails workflow + envíos recientes. Realtime sobre
// email_queue. Tabla con: timestamp, template, to, estado, casilla, intento.
// Cita: D01 (cola persistida + Realtime), regla 13 (useConfirm).

import { useEffect, useMemo, useState } from 'react';
import {
  Mail, Clock, CheckCircle2, AlertCircle, Loader2,
  RotateCcw, X, Layers, Send, Eye,
} from 'lucide-react';
import { AnimatedNumber, useConfirm } from '@/components/common';
import { EmailPreviewModal } from '@/components/common/EmailPreviewModal';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  listEnvios,
  reintentar,
  cancelar,
  CASILLAS,
  type EnvioListItem,
  type EstadoEmail,
  type FromCasilla,
} from '@/services/api/emails';

type EstadoFilter = EstadoEmail | 'todos';
type CasillaFilter = FromCasilla | 'todas';

export function EmailQueuePage() {
  const [rows, setRows] = useState<EnvioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [casilla, setCasilla] = useState<CasillaFilter>('todas');
  const [search, setSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function refresh() {
    const res = await listEnvios({
      estado,
      casilla,
      search: search || undefined,
      limit: 200,
    });
    if (res.ok) setRows(res.data.rows);
    else toast.error('No pudimos cargar la cola', { description: res.error.message });
    setLoading(false);
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [estado, casilla]);

  // Realtime: email_queue + sent_emails
  useEffect(() => {
    const ch = supabase
      .channel('email-queue-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_queue' }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sent_emails' },  () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [estado, casilla]);

  const kpis = useMemo(() => {
    let pendientes = 0, enviados = 0, fallidos = 0;
    for (const r of rows) {
      if (r.estado === 'pendiente') pendientes++;
      else if (r.estado === 'enviado') enviados++;
      else fallidos++;
    }
    return { total: rows.length, pendientes, enviados, fallidos };
  }, [rows]);

  async function handleReintentar(id: string) {
    const r = await reintentar(id);
    if (!r.ok) { toast.error('No pudimos reintentar', { description: r.error.message }); return; }
    toast.success('Re-encolado · el dispatcher lo va a tomar (~1 min)');
    void refresh();
  }

  async function handleCancelar(id: string) {
    const okConfirm = await confirm({
      title: 'Cancelar envío',
      message: '¿Cancelás este email? No se va a enviar.',
      danger: true,
      confirmLabel: 'Cancelar envío',
    });
    if (!okConfirm) return;
    const r = await cancelar(id);
    if (!r.ok) { toast.error('No pudimos cancelar', { description: r.error.message }); return; }
    toast.success('Email cancelado');
    void refresh();
  }

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      <header>
        <p className="kicker text-brand-cyan">Configuración · Emails</p>
        <h1 className="font-display text-2xl font-bold text-brand-ink">
          Cola de envíos
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Throttle global hard <strong>5 min</strong> entre envíos (E42/D05). El cron procesa cada minuto.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total" value={kpis.total} icon={Layers} tone="cyan" active={estado === 'todos'} onClick={() => setEstado('todos')} />
        <KpiCard label="Pendientes" value={kpis.pendientes} icon={Clock} tone="amber" active={estado === 'pendiente'} onClick={() => setEstado('pendiente')} />
        <KpiCard label="Enviados" value={kpis.enviados} icon={CheckCircle2} tone="emerald" active={estado === 'enviado'} onClick={() => setEstado('enviado')} />
        <KpiCard label="Fallidos" value={kpis.fallidos} icon={AlertCircle} tone="red" active={estado === 'fallido'} onClick={() => setEstado('fallido')} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select
          value={casilla}
          onChange={(e) => setCasilla(e.target.value as CasillaFilter)}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="todas">Todas las casillas</option>
          {CASILLAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void refresh(); }}
          placeholder="Buscar por email o asunto…"
          className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-3 py-1 text-sm font-medium text-white hover:bg-brand-cyan-700"
        >
          <Send size={12} /> Aplicar
        </button>
      </div>

      <EmailPreviewModal
        open={previewId !== null}
        envioId={previewId}
        onClose={() => setPreviewId(null)}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-brand-zebra/40 text-left text-xs uppercase tracking-wider text-brand-muted">
            <tr>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Plantilla</th>
              <th className="px-4 py-2">Destinatario</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Casilla</th>
              <th className="px-4 py-2 text-right">Intento</th>
              <th className="px-4 py-2">Error</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-10 text-center text-brand-muted">
                <Loader2 className="mx-auto animate-spin" size={18} />
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-brand-muted">
                Sin envíos en este filtro.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-zebra/30">
                <td className="px-4 py-2 font-mono text-[11px] text-brand-muted">
                  {r.enviado_at
                    ? new Date(r.enviado_at).toLocaleString('es-AR')
                    : r.programado_para
                      ? `prog: ${new Date(r.programado_para).toLocaleString('es-AR')}`
                      : '—'}
                </td>
                <td className="px-4 py-2">
                  <p className="font-medium text-brand-ink">{r.template_nombre ?? r.template_slug ?? '—'}</p>
                  <p className="font-mono text-[10px] text-brand-muted">{r.template_slug}</p>
                </td>
                <td className="px-4 py-2">
                  <p className="text-brand-ink">{r.to_email}</p>
                  {r.administracion_nombre && (
                    <p className="text-[11px] text-brand-muted">{r.administracion_nombre}</p>
                  )}
                </td>
                <td className="px-4 py-2"><EstadoBadge estado={r.estado} /></td>
                <td className="px-4 py-2 text-xs">
                  {r.casilla ? (CASILLAS.find(c => c.value === r.casilla)?.label ?? r.casilla) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular text-xs">
                  {r.intento}/{r.max_intentos}
                </td>
                <td className="px-4 py-2 max-w-xs">
                  <p className="truncate text-xs text-red-700">{r.ultimo_error ?? '—'}</p>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewId(r.id)}
                      title="Ver lo que se envió"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                    >
                      <Eye size={11} /> Ver
                    </button>
                    {r.estado !== 'enviado' && (
                      <button
                        type="button"
                        onClick={() => void handleReintentar(r.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                      >
                        <RotateCcw size={11} /> Reintentar
                      </button>
                    )}
                    {r.estado === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => void handleCancelar(r.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <X size={11} /> Cancelar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tone, active, onClick,
}: {
  label: string; value: number; icon: typeof Mail;
  tone: 'cyan' | 'amber' | 'emerald' | 'red';
  active: boolean; onClick: () => void;
}) {
  const tones = {
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
        'card-premium flex flex-col items-start gap-1 p-4 text-left transition',
        active ? `ring-2 ${tones.replace('text-', 'ring-')}` : 'hover:border-brand-cyan/40',
      )}
    >
      <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', tones)}>
        <Icon size={13} />
        {label}
      </div>
      <p className="font-display text-2xl font-bold tabular text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
    </button>
  );
}

function EstadoBadge({ estado }: { estado: EstadoEmail }) {
  const map: Record<EstadoEmail, { label: string; cls: string; icon: typeof Mail }> = {
    pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700', icon: Clock },
    enviado:   { label: 'Enviado',   cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    fallido:   { label: 'Fallido',   cls: 'bg-red-100 text-red-700', icon: AlertCircle },
  };
  const m = map[estado];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>
      <Icon size={10} />
      {m.label}
    </span>
  );
}
