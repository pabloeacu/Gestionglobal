import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Plus,
  List as ListIcon,
  AlertTriangle,
  ArrowRight,
  GripVertical,
  Receipt,
} from 'lucide-react';
import { Button, SkeletonRow, useConfirm } from '@/components/common';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useSounds } from '@/contexts/SoundContext';
import { cn } from '@/lib/cn';
import { TramiteFormDrawer } from '../components/TramiteFormDrawer';
import {
  listTramites,
  updateTramite,
  computeSla,
  NEXT_ESTADO,
  esAvanceTramite,
  TRAMITE_CATEGORIA_LABEL,
  TRAMITE_PRIORIDAD_LABEL,
  TRAMITE_ESTADO_LABEL,
  type TramiteListItem,
  type TramiteEstado,
  type TramiteCategoria,
  type TramitePrioridad,
} from '@/services/api/tramites';
import { humanizeError } from '@/lib/errors';

// Columnas visibles del kanban (excluimos cancelado por defecto).
const COLUMNS: { key: TramiteEstado; label: string; cls: string }[] = [
  { key: 'abierto', label: 'Abiertos', cls: 'border-blue-300/60 bg-blue-50/60' },
  {
    key: 'en_progreso',
    label: 'En progreso',
    cls: 'border-cyan-300/60 bg-cyan-50/60',
  },
  {
    key: 'esperando_cliente',
    label: 'Esperando cliente',
    cls: 'border-amber-300/60 bg-amber-50/60',
  },
  {
    key: 'resuelto',
    label: 'Resueltos',
    cls: 'border-emerald-300/60 bg-emerald-50/60',
  },
  {
    key: 'cerrado',
    label: 'Cerrados',
    cls: 'border-slate-300/60 bg-slate-50/60',
  },
];

const PRIORIDAD_DOT: Record<TramitePrioridad, string> = {
  baja: 'bg-slate-300',
  normal: 'bg-blue-400',
  alta: 'bg-orange-400',
  urgente: 'bg-red-500',
};

export function TramitesKanbanPage() {
  const [rows, setRows] = useState<TramiteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TramiteEstado | null>(null);
  // DGG-55 · filtro "Comprobante pendiente" (capta DDJJ + huecos).
  const [soloCompPend, setSoloCompPend] = useState(false);
  const { play } = useSounds();
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    const res = await listTramites({
      estados: COLUMNS.map((c) => c.key),
      limit: 500,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(`No pudimos cargar los trámites: ${humanizeError(res.error)}`);
      return;
    }
    setRows(res.data.rows);
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeRefresh(['tramites'], () => void load(), 350);

  const byEstado = useMemo(() => {
    const m: Record<TramiteEstado, TramiteListItem[]> = {
      abierto: [],
      en_progreso: [],
      esperando_cliente: [],
      resuelto: [],
      cerrado: [],
      cancelado: [],
    };
    for (const r of rows) {
      if (soloCompPend && !r.comprobante_pendiente) continue;
      const e = r.estado as TramiteEstado;
      if (m[e]) m[e].push(r);
    }
    return m;
  }, [rows, soloCompPend]);

  // DGG-55 · cantidad de trámites con comprobante pendiente (DDJJ + huecos).
  const compPendCount = useMemo(
    () => rows.filter((r) => r.comprobante_pendiente).length,
    [rows],
  );

  async function mover(t: TramiteListItem, nuevoEstado: TramiteEstado) {
    if (t.estado === nuevoEstado) return;

    // DGG-44 · Gate de cobranza. Si se AVANZA (hacia el cierre) un trámite con
    // un comprobante con costo e impago, pedir confirmación. Soft gate: el
    // usuario siempre puede continuar. No aplica a regresiones ni a trámites
    // sin comprobante (DDJJ) ni con comprobante $0,00 (bonificado/gratuito).
    if (
      esAvanceTramite(t.estado as TramiteEstado, nuevoEstado) &&
      t.cobro_pendiente
    ) {
      const ok = await confirm({
        title: 'Trámite impago',
        message: (
          <div className="space-y-2">
            <p>
              Este trámite no tiene cobranza registrada. Por lo tanto, está
              impago.
            </p>
            <p>¿Desea avanzar la gestión de todos modos?</p>
          </div>
        ),
        confirmLabel: 'Avanzar',
        cancelLabel: 'Cancelar',
      });
      if (!ok) return; // Cancelar → la tarjeta queda donde está.
    }

    // Optimistic update
    setRows((prev) =>
      prev.map((r) => (r.id === t.id ? { ...r, estado: nuevoEstado } : r)),
    );
    play('click');
    const res = await updateTramite(t.id, { estado: nuevoEstado });
    if (!res.ok) {
      toast.error(`No pudimos mover el trámite: ${humanizeError(res.error)}`);
      void load();  // re-sync
      return;
    }
    play('success');
    toast.success(`Trámite ${t.codigo} → ${TRAMITE_ESTADO_LABEL[nuevoEstado]}`);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Trámites · Kanban
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Arrastrá una tarjeta entre columnas o usá el botón →. El cambio se
            persiste al instante.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {compPendCount > 0 && (
            <button
              type="button"
              onClick={() => setSoloCompPend((v) => !v)}
              title="Trámites sin comprobante emitido (DDJJ y otros). Para no perder de vista la cobranza."
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
                soloCompPend
                  ? 'border-violet-400 bg-violet-50 text-violet-700'
                  : 'border-slate-200 text-brand-ink hover:border-violet-300 hover:text-violet-700',
              )}
            >
              <Receipt size={15} /> Comprobante pendiente
              <span className="rounded-full bg-violet-100 px-1.5 text-xs font-bold text-violet-700">
                {compPendCount}
              </span>
            </button>
          )}
          <Link
            to="/gerencia/tramites"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            <ListIcon size={15} /> Lista
          </Link>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus size={16} /> Nuevo trámite
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {COLUMNS.map((c) => (
            <div key={c.key} className="card-premium space-y-3 p-4">
              <SkeletonRow cols={2} />
              <SkeletonRow cols={2} />
              <SkeletonRow cols={2} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = byEstado[col.key];
            const isOver = dragOverCol === col.key;
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol((prev) => (prev === col.key ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  if (!dragId) return;
                  const t = rows.find((r) => r.id === dragId);
                  if (t) void mover(t, col.key);
                  setDragId(null);
                }}
                className={cn(
                  'flex min-h-[400px] flex-col rounded-2xl border p-3 transition-colors',
                  col.cls,
                  isOver &&
                    'ring-2 ring-brand-cyan/50 ring-offset-2 ring-offset-white',
                )}
              >
                <header className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold text-brand-ink">
                    {col.label}
                  </h2>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
                    {items.length}
                  </span>
                </header>
                <div className="flex-1 space-y-2.5">
                  {items.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[11px] text-brand-muted/70">
                      Sin trámites en esta columna
                    </p>
                  ) : (
                    items.map((t, idx) => {
                      const sla = computeSla(t);
                      const nextEst = NEXT_ESTADO[t.estado as TramiteEstado];
                      return (
                        <article
                          key={t.id}
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setDragOverCol(null);
                          }}
                          className={cn(
                            'group rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md motion-safe:animate-fade-up',
                            dragId === t.id && 'opacity-60',
                          )}
                          style={{
                            animationDelay: `${Math.min(idx, 8) * 30}ms`,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical
                              size={14}
                              className="mt-0.5 shrink-0 text-brand-muted/60 group-hover:text-brand-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    'inline-block h-2 w-2 shrink-0 rounded-full',
                                    PRIORIDAD_DOT[t.prioridad as TramitePrioridad],
                                  )}
                                  title={`Prioridad: ${TRAMITE_PRIORIDAD_LABEL[t.prioridad as TramitePrioridad]}`}
                                />
                                <span className="font-mono text-[10px] uppercase tracking-wider text-brand-muted">
                                  {t.codigo}
                                </span>
                              </div>
                              <Link
                                to={`/gerencia/tramites/${t.id}`}
                                className="mt-0.5 block truncate text-sm font-medium text-brand-ink hover:text-brand-cyan"
                                title={t.titulo}
                              >
                                {t.titulo}
                              </Link>
                              <p className="mt-0.5 truncate text-[11px] text-brand-muted">
                                {TRAMITE_CATEGORIA_LABEL[t.categoria as TramiteCategoria]}
                                {t.administracion_nombre && (
                                  <> · {t.administracion_nombre}</>
                                )}
                              </p>
                              {t.comprobante_pendiente && (
                                <span
                                  className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700"
                                  title="Falta emitir el comprobante (ej. DDJJ)"
                                >
                                  <Receipt size={10} /> Comprobante pendiente
                                </span>
                              )}
                              {/* DGG-33: removida etiqueta "Asignado / Sin asignar".
                                  Footer ahora muestra sólo el chip de SLA a la derecha. */}
                              <div className="mt-2 flex items-center justify-end gap-2 text-[10px]">
                                {sla.vencido ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
                                    <AlertTriangle size={10} />
                                    {Math.abs(sla.diasRestantes ?? 0)}d
                                  </span>
                                ) : sla.diasRestantes !== null ? (
                                  <span
                                    className={cn(
                                      'shrink-0 rounded-full px-1.5 py-0.5 font-semibold',
                                      sla.diasRestantes <= 1
                                        ? 'bg-red-50 text-red-700'
                                        : sla.diasRestantes <= 3
                                          ? 'bg-amber-50 text-amber-700'
                                          : 'bg-emerald-50 text-emerald-700',
                                    )}
                                  >
                                    {sla.diasRestantes}d
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-brand-muted/70">
                                    {sla.diasAbierto}d abierto
                                  </span>
                                )}
                              </div>
                              {nextEst && (
                                <button
                                  type="button"
                                  onClick={() => void mover(t, nextEst)}
                                  className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
                                  title={`Avanzar a ${TRAMITE_ESTADO_LABEL[nextEst]}`}
                                >
                                  <ArrowRight size={11} />
                                  {TRAMITE_ESTADO_LABEL[nextEst]}
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TramiteFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}
