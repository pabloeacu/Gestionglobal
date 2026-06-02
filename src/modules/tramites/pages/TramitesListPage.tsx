import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshIndicator } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  Filter,
  Briefcase,
  Inbox,
  CheckCircle2,
  Clock,
  ChevronRight,
  KanbanSquare,
  AlertTriangle,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  SkeletonRow,
  AnimatedNumber,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { TramiteFormDrawer } from '../components/TramiteFormDrawer';
import {
  listTramites,
  computeSla,
  TRAMITE_ESTADOS,
  TRAMITE_CATEGORIAS,
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

type EstadoFilter = TramiteEstado | 'todos';
type CategoriaFilter = TramiteCategoria | 'todos';
type PrioridadFilter = TramitePrioridad | 'todos';

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

export function TramitesListPage() {
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [categoria, setCategoria] = useState<CategoriaFilter>('todos');
  const [prioridad, setPrioridad] = useState<PrioridadFilter>('todos');
  const [rows, setRows] = useState<TramiteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawerOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // F4 · separa primera carga (loading=true → skeleton) de refrescos
  // (refreshing=true → indicador top + data vieja visible, sin flash blanco).
  const [refreshing, setRefreshing] = useState(false);
  const firstLoadDoneRef = useRef(false);
  async function load() {
    if (firstLoadDoneRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const res = await listTramites({ search, estado, categoria, prioridad });
    setLoading(false);
    setRefreshing(false);
    firstLoadDoneRef.current = true;
    if (!res.ok) {
      setError(humanizeError(res.error));
      toast.error(`No pudimos cargar los trámites: ${humanizeError(res.error)}`);
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, categoria, prioridad]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useRealtimeRefresh(['tramites', 'tramite_comentarios'], () => void load());

  const kpis = useMemo(() => {
    const abiertos = rows.filter((r) =>
      ['abierto', 'en_progreso', 'esperando_cliente'].includes(r.estado),
    ).length;
    const resueltos = rows.filter((r) =>
      ['resuelto', 'cerrado'].includes(r.estado),
    ).length;
    const vencidos = rows.filter((r) => computeSla(r).vencido).length;
    const sinAsignar = rows.filter(
      (r) =>
        !r.asignado_a &&
        ['abierto', 'en_progreso', 'esperando_cliente'].includes(r.estado),
    ).length;
    return { abiertos, resueltos, vencidos, sinAsignar };
  }, [rows]);

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({
      label: 'Estado',
      value: estado === 'todos' ? 'Todos' : TRAMITE_ESTADO_LABEL[estado] ?? estado,
    });
    items.push({
      label: 'Categoría',
      value: categoria === 'todos' ? 'Todas' : TRAMITE_CATEGORIA_LABEL[categoria] ?? categoria,
    });
    items.push({
      label: 'Prioridad',
      value: prioridad === 'todos' ? 'Todas' : TRAMITE_PRIORIDAD_LABEL[prioridad] ?? prioridad,
    });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [estado, categoria, prioridad, search]);

  function formatFecha(s: string | null): string {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleDateString('es-AR');
    } catch {
      return s;
    }
  }

  async function onExportPdf() {
    await generateReportPdf<TramiteListItem>({
      filename: `tramites-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Trámites',
      subtitulo: 'Expedientes y solicitudes · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'Abiertos', value: String(kpis.abiertos), tone: 'cyan' },
        { label: 'Resueltos', value: String(kpis.resueltos), tone: 'emerald' },
        { label: 'Sin asignar', value: String(kpis.sinAsignar), tone: 'amber' },
        { label: 'Vencidos', value: String(kpis.vencidos), tone: 'rose' },
      ],
      columns: [
        { key: 'codigo', label: 'Código', width: '12%' },
        { key: 'titulo', label: 'Descripción', width: '28%' },
        { key: 'administracion_nombre', label: 'Cliente', width: '20%',
          format: (r) => r.administracion_nombre ?? r.solicitante_nombre ?? '—' },
        { key: 'estado', label: 'Estado', width: '14%',
          format: (r) => TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado] ?? r.estado },
        { key: 'created_at', label: 'Creación', width: '12%',
          format: (r) => formatFecha(r.created_at) },
        { key: 'vence_at', label: 'Objetivo', width: '14%',
          format: (r) => formatFecha(r.vence_at) },
      ],
      rows,
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
        { key: 'categoria', label: 'Categoría', width: 18,
          value: (r) => TRAMITE_CATEGORIA_LABEL[r.categoria as TramiteCategoria] ?? r.categoria },
        { key: 'administracion_nombre', label: 'Cliente', width: 26,
          value: (r) => r.administracion_nombre ?? r.solicitante_nombre ?? '' },
        { key: 'consorcio_nombre', label: 'Consorcio', width: 20,
          value: (r) => r.consorcio_nombre ?? '' },
        { key: 'asignado_nombre', label: 'Asignado', width: 20,
          value: (r) => r.asignado_nombre ?? '' },
        { key: 'estado', label: 'Estado', width: 16,
          value: (r) => TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado] ?? r.estado },
        { key: 'prioridad', label: 'Prioridad', width: 12,
          value: (r) => TRAMITE_PRIORIDAD_LABEL[r.prioridad as TramitePrioridad] ?? r.prioridad },
        { key: 'created_at', label: 'Creación', width: 14,
          value: (r) => r.created_at ? new Date(r.created_at) : null },
        { key: 'vence_at', label: 'Objetivo', width: 14,
          value: (r) => r.vence_at ? new Date(r.vence_at) : null },
      ],
      rows,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshIndicator show={refreshing} />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Trámites
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Expedientes y solicitudes del ecosistema: matrículas, consultas
            jurídicas, renovaciones, reclamos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            disabled={rows.length === 0}
            hint="Trámites"
          />
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

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Inbox}
          label="Abiertos"
          value={<AnimatedNumber value={kpis.abiertos} />}
          hint={`${total} en la vista`}
          tone="cyan"
          delay={0}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Resueltos"
          value={<AnimatedNumber value={kpis.resueltos} />}
          hint="en este filtro"
          tone="teal"
          delay={60}
        />
        <KpiCard
          icon={Clock}
          label="Sin asignar"
          value={<AnimatedNumber value={kpis.sinAsignar} />}
          hint="acción requerida"
          tone="amber"
          delay={120}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Vencidos"
          value={<AnimatedNumber value={kpis.vencidos} />}
          hint="fuera de SLA"
          tone="amber"
          delay={180}
        />
      </section>

      {/* Toolbar */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Buscar" className="flex-1">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Título, código, solicitante…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Estado" className="sm:w-44">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFilter)}
              className="pl-9"
            >
              <option value="todos">Todos</option>
              {TRAMITE_ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {TRAMITE_ESTADO_LABEL[e]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Categoría" className="sm:w-44">
          <Select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaFilter)}
          >
            <option value="todos">Todas</option>
            {TRAMITE_CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {TRAMITE_CATEGORIA_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prioridad" className="sm:w-36">
          <Select
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value as PrioridadFilter)}
          >
            <option value="todos">Todas</option>
            <option value="urgente">Urgente</option>
            <option value="alta">Alta</option>
            <option value="normal">Normal</option>
            <option value="baja">Baja</option>
          </Select>
        </Field>
      </section>

      {/* Table */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-25"
        />
        <div className="relative">
          {loading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonRow key={i} cols={6} />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-600">{error}</div>
          ) : rows.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title="Sin trámites con estos filtros"
              description={
                <>
                  Creá uno nuevo o ajustá los filtros para encontrar lo que
                  buscás.
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Nuevo trámite
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    <th className="px-4 py-3">Trámite</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Asignado</th>
                    <th className="px-4 py-3">SLA</th>
                    <th className="px-4 py-3">Prioridad</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const sla = computeSla(r);
                    return (
                      <tr
                        key={r.id}
                        className="group border-b border-slate-100 transition-colors hover:bg-brand-zebra/40 motion-safe:animate-fade-up"
                        style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
                      >
                        <td className="px-4 py-3">
                          <Link
                            to={`/gerencia/tramites/${r.id}`}
                            className="flex items-center gap-3 font-medium text-brand-ink transition group-hover:text-brand-cyan"
                          >
                            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                              <Briefcase size={15} />
                            </span>
                            <span className="min-w-0">
                              <span className="block">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-brand-muted">
                                  {r.codigo}
                                </span>{' '}
                                <span className="text-[11px] text-brand-muted">
                                  {TRAMITE_CATEGORIA_LABEL[r.categoria as TramiteCategoria]}
                                </span>
                              </span>
                              <span className="block truncate">{r.titulo}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-brand-muted">
                          {r.administracion_nombre ? (
                            <Link
                              to={`/gerencia/clientes/${r.administracion_id}`}
                              className="hover:text-brand-cyan"
                            >
                              {r.administracion_nombre}
                            </Link>
                          ) : (
                            <span className="italic text-brand-muted/70">
                              {r.solicitante_nombre ?? 'Sin cliente'}
                            </span>
                          )}
                          {r.consorcio_nombre && (
                            <span className="block text-xs">
                              · {r.consorcio_nombre}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-brand-muted">
                          {r.asignado_nombre ?? (
                            <span className="italic text-amber-700">
                              Sin asignar
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {sla.diasRestantes === null ? (
                            <span className="text-xs text-brand-muted">
                              {sla.diasAbierto}d abierto
                            </span>
                          ) : sla.vencido ? (
                            <span className="text-xs font-semibold text-red-700">
                              Vencido hace {Math.abs(sla.diasRestantes)}d
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'text-xs font-medium',
                                sla.diasRestantes <= 1
                                  ? 'text-red-700'
                                  : sla.diasRestantes <= 3
                                    ? 'text-amber-700'
                                    : 'text-emerald-700',
                              )}
                            >
                              {sla.diasRestantes}d restantes
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              PRIORIDAD_BADGES[r.prioridad as TramitePrioridad],
                            )}
                          >
                            {TRAMITE_PRIORIDAD_LABEL[r.prioridad as TramitePrioridad]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              ESTADO_BADGES[r.estado as TramiteEstado],
                            )}
                          >
                            {TRAMITE_ESTADO_LABEL[r.estado as TramiteEstado]}
                          </span>
                          <span className="ml-2 text-[10px] text-brand-muted">
                            {formatDateTime(r.ultima_actividad_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/gerencia/tramites/${r.id}`}
                            className="inline-flex text-brand-muted transition-transform group-hover:translate-x-1 group-hover:text-brand-cyan"
                            aria-label="Abrir trámite"
                          >
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

      <TramiteFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  delay = 0,
}: {
  icon: typeof Inbox;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: 'cyan' | 'teal' | 'amber';
  delay?: number;
}) {
  const ring =
    tone === 'cyan'
      ? 'border-brand-cyan/30 hover:border-brand-cyan/60'
      : tone === 'teal'
        ? 'border-brand-teal/30 hover:border-brand-teal/60'
        : 'border-amber-300/50 hover:border-amber-400/70';
  const iconCls =
    tone === 'cyan'
      ? 'bg-brand-cyan-pale/50 text-brand-cyan'
      : tone === 'teal'
        ? 'bg-brand-teal/10 text-brand-teal'
        : 'bg-amber-100 text-amber-700';
  return (
    <div
      className={cn(
        'card-premium relative overflow-hidden border p-4 transition-all motion-safe:animate-fade-up',
        ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-9 w-9 place-items-center rounded-lg',
            iconCls,
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            {label}
          </p>
          <p className="font-display text-2xl font-bold text-brand-ink">
            {value}
          </p>
          {hint && <p className="text-[11px] text-brand-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
