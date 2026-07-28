import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { Plus, Briefcase, ChevronRight, KanbanSquare, Receipt, AlertTriangle, ArrowRight, Copy, Wallet, Clock, ListFilter, Search, X } from 'lucide-react';
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
import { useAvanzarTramite } from '../lib/useAvanzarTramite';
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
  NEXT_ESTADO,
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

// Filtro de SLA propio del encabezado (pedido estético de Pablo 28/07: los
// encabezados no solo ordenan — también filtran). Valores derivados de
// computeSla, sin alterar datos.
type SlaFiltro = 'vencido' | 'pronto' | 'en_plazo' | 'sin_sla';
const SLA_FILTRO_LABEL: Record<SlaFiltro, string> = {
  vencido: 'Vencidos',
  pronto: 'Vencen en ≤ 3 días',
  en_plazo: 'En plazo',
  sin_sla: 'Sin SLA (días abiertos)',
};

// Popover de filtro por columna: botón embudo al lado del SortHeader.
// Presentacional puro — el estado vive en la página (misma fuente de verdad
// que los chips de arriba cuando la columna ya tiene filtro global).
function HeaderFilter({ active, align = 'left', children }: { active: boolean; align?: 'left' | 'right'; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);
  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Filtrar esta columna"
        className={cn(
          'ml-1 rounded p-0.5 transition',
          active ? 'text-brand-cyan' : 'text-brand-muted/50 hover:text-brand-ink',
        )}
      >
        <ListFilter size={12} />
      </button>
      {open && (
        <div className={cn(
          'absolute top-6 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg normal-case tracking-normal',
          align === 'right' ? 'right-0' : 'left-0',
        )}>
          {children}
        </div>
      )}
    </div>
  );
}

export function TramitesListPage() {
  const [universe, setUniverse] = useState<TramiteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [f, setF] = useState<TramitesFilterState>(INITIAL_TRAMITES_FILTER);
  // Filtros propios de los encabezados (columna Cliente y SLA — Prioridad y
  // Estado reusan f.prioridades / f.estados: una sola fuente de verdad).
  const [clienteQ, setClienteQ] = useState('');
  const [slaFil, setSlaFil] = useState<SlaFiltro | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  function update(patch: Partial<TramitesFilterState>) {
    setF((prev) => ({ ...prev, ...patch }));
  }
  function clear() {
    setF(INITIAL_TRAMITES_FILTER);
    setClienteQ('');
    setSlaFil(null);
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

  // DGG-87 · atajo de avance de estado en la lista — MISMO flujo que el kanban
  // (hook compartido: gate de cobranza + updateTramite + toasts). La BD es la
  // única fuente de verdad; lo que cambie acá se refleja en el kanban y viceversa.
  const avanzar = useAvanzarTramite({
    onOptimistic: (id, nuevoEstado) =>
      setUniverse((prev) => prev.map((r) => (r.id === id ? { ...r, estado: nuevoEstado } : r))),
    onError: () => void load(),
  });

  const counts = useMemo(() => countSegments(universe), [universe]);
  const servicioOpts = useMemo(() => servicioOptions(universe), [universe]);
  const filtered = useMemo(() => applyTramitesFilters(universe, f), [universe, f]);
  // Filtros de encabezado (Cliente / SLA) aplicados sobre el filtrado global.
  const visible = useMemo(() => {
    const needle = clienteQ.trim().toLowerCase();
    return filtered.filter((t) => {
      if (needle) {
        const hay = `${t.administracion_nombre ?? ''} ${t.solicitante_nombre ?? ''} ${t.consorcio_nombre ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (slaFil) {
        const s = computeSla(t);
        if (slaFil === 'sin_sla' && s.diasRestantes !== null) return false;
        if (slaFil === 'vencido' && !s.vencido) return false;
        if (slaFil === 'pronto' && (s.diasRestantes === null || s.vencido || s.diasRestantes > 3)) return false;
        if (slaFil === 'en_plazo' && (s.diasRestantes === null || s.vencido || s.diasRestantes <= 3)) return false;
      }
      return true;
    });
  }, [filtered, clienteQ, slaFil]);
  const { sorted, sort, toggle: toggleSort } = useSort<TramiteListItem>(visible, SORT_ACCESSORS, null);

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
    if (clienteQ.trim()) items.push({ label: 'Cliente', value: clienteQ.trim() });
    if (slaFil) items.push({ label: 'SLA', value: SLA_FILTRO_LABEL[slaFil] });
    return items;
  }, [f, clienteQ, slaFil]);

  // Filtros de columna incluidos: el empty state y "Limpiar" los conocen.
  const hayFiltrosActivos = hasActiveTramitesFilters(f) || clienteQ.trim() !== '' || slaFil !== null;

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
              title={hayFiltrosActivos ? 'Sin trámites con estos filtros' : 'Sin trámites todavía'}
              description={hayFiltrosActivos ? <>Ajustá o limpiá los filtros para ver más.</> : <>Creá el primer trámite o esperá a que entren solicitudes.</>}
              action={hayFiltrosActivos
                ? <Button variant="secondary" onClick={clear}>Limpiar filtros</Button>
                : <Button onClick={() => setDrawerOpen(true)}><Plus size={15} /> Nuevo trámite</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left">
                    <th className="w-[34%] px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">Trámite</th>
                    <th className="px-3 py-3">
                      <SortHeader label="Cliente" sortKey="cliente" sort={sort} onToggle={toggleSort} />
                      <HeaderFilter active={clienteQ.trim() !== ''}>
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                          <Search size={13} className="shrink-0 text-brand-muted" />
                          <input
                            autoFocus
                            value={clienteQ}
                            onChange={(e) => setClienteQ(e.target.value)}
                            placeholder="Filtrar cliente…"
                            className="w-full bg-transparent text-xs font-normal outline-none placeholder:text-brand-muted/60"
                          />
                          {clienteQ && (
                            <button type="button" onClick={() => setClienteQ('')} aria-label="Limpiar" className="text-brand-muted hover:text-brand-ink">
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </HeaderFilter>
                    </th>
                    <th className="px-3 py-3">
                      <SortHeader label="SLA" sortKey="sla" sort={sort} onToggle={toggleSort} />
                      <HeaderFilter active={slaFil !== null}>
                        {(Object.keys(SLA_FILTRO_LABEL) as SlaFiltro[]).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setSlaFil((prev) => (prev === k ? null : k))}
                            className={cn(
                              'block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition',
                              slaFil === k ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-brand-ink hover:bg-slate-50',
                            )}
                          >
                            {SLA_FILTRO_LABEL[k]}
                          </button>
                        ))}
                      </HeaderFilter>
                    </th>
                    <th className="px-3 py-3">
                      <SortHeader label="Prioridad" sortKey="prioridad" sort={sort} onToggle={toggleSort} />
                      <HeaderFilter active={f.prioridades.length > 0} align="right">
                        {(Object.keys(TRAMITE_PRIORIDAD_LABEL) as TramitePrioridad[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() =>
                              update({
                                prioridades: f.prioridades.includes(p)
                                  ? f.prioridades.filter((x) => x !== p)
                                  : [...f.prioridades, p],
                              })
                            }
                            className={cn(
                              'block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition',
                              f.prioridades.includes(p) ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-brand-ink hover:bg-slate-50',
                            )}
                          >
                            {TRAMITE_PRIORIDAD_LABEL[p]}
                          </button>
                        ))}
                      </HeaderFilter>
                    </th>
                    <th className="px-3 py-3">
                      <SortHeader label="Estado" sortKey="estado" sort={sort} onToggle={toggleSort} />
                      <HeaderFilter active={f.estados.length > 0} align="right">
                        {(Object.keys(TRAMITE_ESTADO_LABEL) as TramiteEstado[]).map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() =>
                              update({
                                estados: f.estados.includes(e)
                                  ? f.estados.filter((x) => x !== e)
                                  : [...f.estados, e],
                              })
                            }
                            className={cn(
                              'block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition',
                              f.estados.includes(e) ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-brand-ink hover:bg-slate-50',
                            )}
                          >
                            {TRAMITE_ESTADO_LABEL[e]}
                          </button>
                        ))}
                      </HeaderFilter>
                    </th>
                    <th className="w-10 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => {
                    const sla = computeSla(r);
                    const nextEst = NEXT_ESTADO[r.estado as TramiteEstado];
                    return (
                      <tr
                        key={r.id}
                        className="group border-b border-slate-100 transition-colors hover:bg-brand-zebra/40 motion-safe:animate-fade-up"
                        style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}
                      >
                        <td className="max-w-0 px-3 py-3">
                          <Link to={`/gerencia/tramites/${r.id}`} className="flex items-center gap-2.5 font-medium text-brand-ink transition group-hover:text-brand-cyan">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                              <Briefcase size={15} />
                            </span>
                            <span className="min-w-0">
                              <span className="block">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-brand-muted">{r.codigo}</span>{' '}
                                <span className="text-[11px] text-brand-muted">{TRAMITE_CATEGORIA_LABEL[r.categoria as TramiteCategoria]}</span>
                              </span>
                              {/* Ellipsis + tooltip con el título completo (pedido Pablo 28/07:
                                  no se suprime info — se lee entera al posar el mouse). */}
                              <span className="block truncate" title={r.titulo}>{r.titulo}</span>
                              {r.comprobante_pendiente && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700" title="Falta emitir el comprobante (ej. DDJJ)">
                                  <Receipt size={10} /> Comprobante pendiente
                                </span>
                              )}
                              {r.posible_duplicado && (
                                <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700" title="Hay otro trámite del mismo solicitante y servicio en el mismo período — posible reenvío del formulario">
                                  <Copy size={10} /> Posible duplicado
                                </span>
                              )}
                              {/* E-GG-116 · P7-A (JL): el cliente tiene saldo pendiente (deuda neta) en su Cta.Cte. */}
                              {r.tiene_deuda && (
                                <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700" title="Este cliente tiene saldo pendiente en su Cuenta Corriente">
                                  <Wallet size={10} /> Con Deuda
                                </span>
                              )}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-brand-muted">
                          {r.administracion_nombre ? (
                            <Link to={`/gerencia/clientes/${r.administracion_id}`} className="hover:text-brand-cyan">{r.administracion_nombre}</Link>
                          ) : (
                            <span className="italic text-brand-muted/70">{r.solicitante_nombre ?? 'Sin cliente'}</span>
                          )}
                          {r.consorcio_nombre && <span className="block text-xs">· {r.consorcio_nombre}</span>}
                        </td>
                        <td className="px-3 py-3">
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
                        <td className="px-3 py-3">
                          <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', PRIORIDAD_BADGES[r.prioridad as TramitePrioridad])}>
                            {TRAMITE_PRIORIDAD_LABEL[r.prioridad as TramitePrioridad]}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', ESTADO_BADGES[r.estado as TramiteEstado])}>
                              {TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado]}
                            </span>
                            {/* Última actividad → relojito con tooltip propio: instantáneo
                                (sin el delay del title nativo) y cursor normal (pedido Pablo). */}
                            <span className="group/clock relative inline-flex text-brand-muted/60 transition hover:text-brand-cyan">
                              <Clock size={13} />
                              <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden whitespace-nowrap rounded-lg bg-brand-ink px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg group-hover/clock:block">
                                Última actividad: {formatDateTime(r.ultima_actividad_at)}
                              </span>
                            </span>
                          </div>
                          {nextEst && (
                            <button
                              type="button"
                              onClick={() => void avanzar(r, nextEst)}
                              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
                              title={`Avanzar a ${TRAMITE_ESTADO_LABEL[nextEst]}`}
                            >
                              <ArrowRight size={11} /> {TRAMITE_ESTADO_LABEL[nextEst]}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
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
