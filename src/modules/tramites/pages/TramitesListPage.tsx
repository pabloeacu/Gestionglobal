import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { Plus, Briefcase, ChevronRight, KanbanSquare, Receipt, AlertTriangle } from 'lucide-react';
import {
  Button,
  RefreshIndicator,
  SkeletonRow,
  SortHeader,
  useSort,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { TramiteFormDrawer } from '../components/TramiteFormDrawer';
import { TramitesSegmentos, TramitesFilterBar } from '../components/TramitesFiltros';
import {
  ACTIVE_ESTADOS,
  applyTramitesFilters,
  countSegments,
  servicioOptions,
  hasActiveTramitesFilters,
  INITIAL_TRAMITES_FILTER,
  TRAMITE_SEGMENTOS,
  type TramitesFilterState,
  type SegmentKey,
} from '../components/tramitesFilter';
import {
  listTramites,
  computeSla,
  TRAMITE_CATEGORIA_LABEL,
  TRAMITE_ESTADO_LABEL,
  TRAMITE_PRIORIDAD_LABEL,
  type TramiteListItem,
  type TramiteEstado,
  type TramiteCategoria,
  type TramitePrioridad,
} from '@/services/api/tramites';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

const ESTADO_BADGES: Record<TramiteEstado, string> = {
  abierto: 'bg-blue-50 text-blue-700 border-blue-200',
  en_progreso: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  esperando_cliente: 'bg-amber-50 text-amber-700 border-amber-200',
  resuelto: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cerrado: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelado: 'bg-red-50 text-red-700 border-red-200',
};
const PRIORIDAD_BADGES: Record<TramitePrioridad, string> = {
  baja: 'bg-slate-100 text-slate-600 border-slate-200',
  normal: 'bg-blue-50 text-blue-700 border-blue-200',
  alta: 'bg-orange-50 text-orange-700 border-orange-200',
  urgente: 'bg-red-50 text-red-700 border-red-200',
};

const PRIORIDAD_RANK: Record<TramitePrioridad, number> = { urgente: 0, alta: 1, normal: 2, baja: 3 };
const ESTADO_RANK: Record<TramiteEstado, number> = {
  abierto: 0, en_progreso: 1, esperando_cliente: 2, resuelto: 3, cerrado: 4, cancelado: 5,
};

// Accesores de orden (estable a nivel módulo para useSort).
const SORT_ACCESSORS: Record<string, (t: TramiteListItem) => string | number | null | undefined> = {
  cliente: (t) => (t.administracion_nombre ?? t.solicitante_nombre ?? '').toLowerCase(),
  sla: (t) => computeSla(t).diasRestantes, // negativo = vencido; null = sin SLA (va al final)
  prioridad: (t) => PRIORIDAD_RANK[t.prioridad as TramitePrioridad] ?? 99,
  estado: (t) => ESTADO_RANK[t.estado as TramiteEstado] ?? 99,
};

const MAX_UNIVERSO = 1000;

export function TramitesListPage() {
  const [universe, setUniverse] = useState<TramiteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [f, setF] = useState<TramitesFilterState>(INITIAL_TRAMITES_FILTER);
  const [searchParams, setSearchParams] = useSearchParams();

  function update(patch: Partial<TramitesFilterState>) {
    setF((prev) => ({ ...prev, ...patch }));
  }
  function clear() {
    setF(INITIAL_TRAMITES_FILTER);
  }
  function toggleSegment(key: SegmentKey) {
    setF((prev) => ({ ...prev, segment: prev.segment === key ? null : key }));
  }

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawerOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const firstLoadDoneRef = useRef(false);
  async function load() {
    if (firstLoadDoneRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    // El universo se trae por backend según "Solo activos" (R19: el resto en
    // memoria). Activos por default; todo al apagar el switch.
    const res = await listTramites({
      estados: f.soloActivos ? ACTIVE_ESTADOS : undefined,
      limit: MAX_UNIVERSO,
    });
    setLoading(false);
    setRefreshing(false);
    firstLoadDoneRef.current = true;
    if (!res.ok) {
      setError(humanizeError(res.error));
      toast.error(`No pudimos cargar los trámites: ${humanizeError(res.error)}`);
      return;
    }
    setUniverse(res.data.rows);
    setTotal(res.data.total);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.soloActivos]);

  useRealtimeRefresh(['tramites', 'tramite_comentarios'], () => void load());

  const counts = useMemo(() => countSegments(universe), [universe]);
  const servicioOpts = useMemo(() => servicioOptions(universe), [universe]);
  const filtered = useMemo(() => applyTramitesFilters(universe, f), [universe, f]);
  const { sorted, sort, toggle: toggleSort } = useSort<TramiteListItem>(filtered, SORT_ACCESSORS, null);

  // Aviso (no silent cap, R19/§6): si el universo excede el tope, lo decimos.
  const universoTruncado = total > universe.length;

  // Export del filtrado actual (el set visible: `sorted`).
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({ label: 'Vista', value: f.soloActivos ? 'Solo activos' : 'Todos' });
    if (f.segment) items.push({ label: 'Segmento', value: TRAMITE_SEGMENTOS.find((s) => s.key === f.segment)?.label ?? f.segment });
    if (f.estados.length) items.push({ label: 'Estado', value: f.estados.map((e) => TRAMITE_ESTADO_LABEL[e]).join(', ') });
    if (f.prioridades.length) items.push({ label: 'Prioridad', value: f.prioridades.map((p) => TRAMITE_PRIORIDAD_LABEL[p]).join(', ') });
    if (f.categorias.length) items.push({ label: 'Categoría', value: f.categorias.map((c) => TRAMITE_CATEGORIA_LABEL[c]).join(', ') });
    if (f.search.trim()) items.push({ label: 'Búsqueda', value: f.search.trim() });
    return items;
  }, [f]);

  function formatFecha(s: string | null): string {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('es-AR'); } catch { return s; }
  }

  async function onExportPdf() {
    await generateReportPdf<TramiteListItem>({
      filename: `tramites-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Trámites',
      subtitulo: 'Expedientes y solicitudes · Gestión Global',
      filtros: exportFiltros,
      kpis: TRAMITE_SEGMENTOS.map((s) => ({
        label: s.label,
        value: String(counts[s.key]),
        tone: (s.tone === 'red' ? 'rose' : s.tone === 'amber' ? 'amber' : s.tone === 'emerald' ? 'emerald' : s.tone === 'cyan' ? 'cyan' : 'ink') as 'rose' | 'amber' | 'emerald' | 'cyan' | 'ink',
      })),
      columns: [
        { key: 'codigo', label: 'Código', width: '12%' },
        { key: 'titulo', label: 'Descripción', width: '28%' },
        { key: 'administracion_nombre', label: 'Cliente', width: '20%', format: (r) => r.administracion_nombre ?? r.solicitante_nombre ?? '—' },
        { key: 'estado', label: 'Estado', width: '14%', format: (r) => TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado] ?? r.estado },
        { key: 'created_at', label: 'Creación', width: '12%', format: (r) => formatFecha(r.created_at) },
        { key: 'vence_at', label: 'Objetivo', width: '14%', format: (r) => formatFecha(r.vence_at) },
      ],
      rows: sorted,
    });
  }

  async function onExportXls() {
    generateReportXls<TramiteListItem>({
      filename: `tramites-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Trámites',
      titulo: 'Trámites · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'codigo', label: 'Código', width: 14 },
        { key: 'titulo', label: 'Descripción', width: 32 },
        { key: 'categoria', label: 'Categoría', width: 18, value: (r) => TRAMITE_CATEGORIA_LABEL[r.categoria as TramiteCategoria] ?? r.categoria },
        { key: 'administracion_nombre', label: 'Cliente', width: 26, value: (r) => r.administracion_nombre ?? r.solicitante_nombre ?? '' },
        { key: 'consorcio_nombre', label: 'Consorcio', width: 20, value: (r) => r.consorcio_nombre ?? '' },
        { key: 'estado', label: 'Estado', width: 16, value: (r) => TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado] ?? r.estado },
        { key: 'prioridad', label: 'Prioridad', width: 12, value: (r) => TRAMITE_PRIORIDAD_LABEL[r.prioridad as TramitePrioridad] ?? r.prioridad },
        { key: 'created_at', label: 'Creación', width: 14, value: (r) => (r.created_at ? new Date(r.created_at) : null) },
        { key: 'vence_at', label: 'Objetivo', width: 14, value: (r) => (r.vence_at ? new Date(r.vence_at) : null) },
      ],
      rows: sorted,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshIndicator show={refreshing} />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">Trámites</h1>
          <p className="mt-1 text-sm text-brand-muted">
            Expedientes y solicitudes del ecosistema: matrículas, consultas jurídicas, renovaciones, reclamos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons onExportPdf={onExportPdf} onExportXls={onExportXls} disabled={sorted.length === 0} hint="Trámites" />
          <Link
            to="/gerencia/tramites/kanban"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
            title="Vista kanban"
          >
            <KanbanSquare size={15} /> Kanban
          </Link>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus size={16} /> Nuevo trámite
          </Button>
        </div>
      </header>

      {/* F8 · Segmentos inteligentes (cards filtro) */}
      <TramitesSegmentos counts={counts} active={f.segment} onToggle={toggleSegment} />

      {/* F8 · Barra de filtros premium */}
      <TramitesFilterBar
        f={f}
        update={update}
        servicioOpts={servicioOpts}
        shown={sorted.length}
        total={universe.length}
        onClear={clear}
      />

      {universoTruncado && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={13} className="shrink-0" />
          Mostrando {universe.length} de {total} trámites. Afiná los filtros o usá la búsqueda para no perder ninguno.
        </p>
      )}

      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent position="top-right" size={140} tone="cyan" density="soft" className="opacity-25" />
        <div className="relative">
          {loading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-600">{error}</div>
          ) : sorted.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={hasActiveTramitesFilters(f) ? 'Sin trámites con estos filtros' : 'Sin trámites todavía'}
              description={hasActiveTramitesFilters(f) ? <>Ajustá o limpiá los filtros para ver más.</> : <>Creá el primer trámite o esperá a que entren solicitudes.</>}
              action={hasActiveTramitesFilters(f)
                ? <Button variant="secondary" onClick={clear}>Limpiar filtros</Button>
                : <Button onClick={() => setDrawerOpen(true)}><Plus size={15} /> Nuevo trámite</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">Trámite</th>
                    <th className="px-4 py-3"><SortHeader label="Cliente" sortKey="cliente" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="SLA" sortKey="sla" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="Prioridad" sortKey="prioridad" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="Estado" sortKey="estado" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => {
                    const sla = computeSla(r);
                    return (
                      <tr
                        key={r.id}
                        className="group border-b border-slate-100 transition-colors hover:bg-brand-zebra/40 motion-safe:animate-fade-up"
                        style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}
                      >
                        <td className="px-4 py-3">
                          <Link to={`/gerencia/tramites/${r.id}`} className="flex items-center gap-3 font-medium text-brand-ink transition group-hover:text-brand-cyan">
                            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                              <Briefcase size={15} />
                            </span>
                            <span className="min-w-0">
                              <span className="block">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-brand-muted">{r.codigo}</span>{' '}
                                <span className="text-[11px] text-brand-muted">{TRAMITE_CATEGORIA_LABEL[r.categoria as TramiteCategoria]}</span>
                              </span>
                              <span className="block truncate">{r.titulo}</span>
                              {r.comprobante_pendiente && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700" title="Falta emitir el comprobante (ej. DDJJ)">
                                  <Receipt size={10} /> Comprobante pendiente
                                </span>
                              )}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-brand-muted">
                          {r.administracion_nombre ? (
                            <Link to={`/gerencia/clientes/${r.administracion_id}`} className="hover:text-brand-cyan">{r.administracion_nombre}</Link>
                          ) : (
                            <span className="italic text-brand-muted/70">{r.solicitante_nombre ?? 'Sin cliente'}</span>
                          )}
                          {r.consorcio_nombre && <span className="block text-xs">· {r.consorcio_nombre}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {sla.diasRestantes === null ? (
                            <span className="text-xs text-brand-muted">{sla.diasAbierto}d abierto</span>
                          ) : sla.vencido ? (
                            <span className="text-xs font-semibold text-red-700">Vencido hace {Math.abs(sla.diasRestantes)}d</span>
                          ) : (
                            <span className={cn('text-xs font-medium', sla.diasRestantes <= 1 ? 'text-red-700' : sla.diasRestantes <= 3 ? 'text-amber-700' : 'text-emerald-700')}>
                              {sla.diasRestantes}d restantes
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', PRIORIDAD_BADGES[r.prioridad as TramitePrioridad])}>
                            {TRAMITE_PRIORIDAD_LABEL[r.prioridad as TramitePrioridad]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', ESTADO_BADGES[r.estado as TramiteEstado])}>
                            {TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado]}
                          </span>
                          <span className="ml-2 text-[10px] text-brand-muted">{formatDateTime(r.ultima_actividad_at)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/gerencia/tramites/${r.id}`} className="inline-flex text-brand-muted transition-transform group-hover:translate-x-1 group-hover:text-brand-cyan" aria-label="Abrir trámite">
                            <ChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <TramiteFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onCreated={() => void load()} />
    </div>
  );
}
