import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  FileText,
  Filter,
  ChevronRight,
  Receipt,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
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
import { ComprobanteFormDrawer } from '../components/ComprobanteFormDrawer';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort as formatDate } from '@/lib/dates';
import {
  listComprobantes,
  type ComprobanteListItem,
  type ComprobanteEstado,
  type CobranzaEstado,
} from '@/services/api/comprobantes';
import { cn } from '@/lib/cn';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { copyAsCsv } from '@/lib/csvCopy';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';

type EstadoFilter = ComprobanteEstado | 'todos';
type CobranzaFilter = CobranzaEstado | 'todos';

const ESTADO_BADGES: Record<ComprobanteEstado, { label: string; cls: string }> = {
  borrador:   { label: 'Borrador',   cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  procesando: { label: 'Procesando', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  autorizado: { label: 'Autorizado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  observado:  { label: 'Observado',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  rechazado:  { label: 'Rechazado',  cls: 'bg-red-50 text-red-700 border-red-200' },
  anulado:    { label: 'Anulado',    cls: 'bg-red-50 text-red-700 border-red-200' },
  compensado: { label: 'Compensado', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  error:      { label: 'Error',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

const COBRANZA_BADGES: Record<CobranzaEstado, { label: string; cls: string }> = {
  pendiente:   { label: 'Pendiente',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  parcial:     { label: 'Parcial',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pagado:      { label: 'Pagado',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vencido:     { label: 'Vencido',     cls: 'bg-red-50 text-red-700 border-red-200' },
  en_recupero: { label: 'Recupero',    cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  anulado:     { label: '—',           cls: 'bg-transparent text-transparent border-transparent' },
};

export function ComprobantesListPage() {
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [cobranza, setCobranza] = useState<CobranzaFilter>('todos');
  const [periodo, setPeriodo] = useState<string>(currentPeriodo());
  const [rows, setRows] = useState<ComprobanteListItem[]>([]);
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

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listComprobantes({
      search,
      estado,
      estadoCobranza: cobranza,
      periodo: periodo || undefined,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      toast.error(`No pudimos cargar los comprobantes: ${res.error.message}`);
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, cobranza, periodo]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useRealtimeRefresh(['comprobantes', 'items_comprobantes'], () => void load());

  const kpis = useMemo(() => {
    const emitidos = rows.filter((r) => r.estado === 'autorizado').length;
    const totalEmitido = rows
      .filter((r) => r.estado === 'autorizado')
      .reduce((s, r) => s + Number(r.total ?? 0), 0);
    const totalPendiente = rows
      .filter((r) => r.estado_cobranza === 'pendiente' || r.estado_cobranza === 'parcial')
      .reduce((s, r) => s + Number(r.saldo_pendiente ?? 0), 0);
    const totalVencido = rows
      .filter((r) => r.estado_cobranza === 'vencido')
      .reduce((s, r) => s + Number(r.saldo_pendiente ?? 0), 0);
    return { emitidos, totalEmitido, totalPendiente, totalVencido };
  }, [rows]);

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (periodo) items.push({ label: 'Período', value: periodo.slice(0, 7) });
    items.push({
      label: 'Estado',
      value: estado === 'todos' ? 'Todos' : ESTADO_BADGES[estado]?.label ?? estado,
    });
    items.push({
      label: 'Cobranza',
      value:
        cobranza === 'todos' ? 'Todas' : COBRANZA_BADGES[cobranza]?.label ?? cobranza,
    });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [periodo, estado, cobranza, search]);

  function formatComprobante(r: ComprobanteListItem): string {
    return `${r.tipo} ${String(r.punto_venta).padStart(5, '0')}-${
      r.numero ? String(r.numero).padStart(8, '0') : '—'
    }`;
  }

  async function onExportPdf() {
    await generateReportPdf<ComprobanteListItem>({
      filename: `comprobantes-${periodo?.slice(0, 7) || new Date().toISOString().slice(0, 7)}`,
      titulo: 'Comprobantes',
      subtitulo: `Facturación · ${periodo?.slice(0, 7) || 'todos los periodos'}`,
      filtros: exportFiltros,
      kpis: [
        { label: 'Emitidos', value: String(kpis.emitidos), tone: 'cyan' },
        { label: 'Total emitido', value: formatMoney(kpis.totalEmitido), tone: 'emerald' },
        { label: 'Pendiente', value: formatMoney(kpis.totalPendiente), tone: 'amber' },
        { label: 'Vencido', value: formatMoney(kpis.totalVencido), tone: 'rose' },
      ],
      columns: [
        { key: 'tipo', label: 'Comprobante', width: '20%',
          format: (r) => formatComprobante(r) },
        { key: 'fecha', label: 'Fecha', width: '12%',
          format: (r) => r.fecha ? formatDate(r.fecha) : '—' },
        { key: 'administracion_nombre', label: 'Administración', width: '24%' },
        { key: 'total', label: 'Total', align: 'right', width: '14%',
          format: (r) => formatMoney(r.total) },
        { key: 'estado_cobranza', label: 'Cobranza', width: '14%',
          format: (r) => COBRANZA_BADGES[r.estado_cobranza as CobranzaEstado]?.label ?? r.estado_cobranza },
        { key: 'estado', label: 'Estado', width: '16%',
          format: (r) => ESTADO_BADGES[r.estado as ComprobanteEstado]?.label ?? r.estado },
      ],
      rows,
    });
  }

  async function onExportXls() {
    generateReportXls<ComprobanteListItem>({
      filename: `comprobantes-${periodo?.slice(0, 7) || new Date().toISOString().slice(0, 7)}`,
      sheetName: 'Comprobantes',
      titulo: 'Comprobantes · Gestión Global',
      subtitulo: periodo ? `Período: ${periodo.slice(0, 7)}` : undefined,
      filtros: exportFiltros,
      columns: [
        { key: 'tipo', label: 'Tipo', width: 8 },
        { key: 'numero', label: 'Número', width: 18,
          value: (r) => `${String(r.punto_venta).padStart(5, '0')}-${
            r.numero ? String(r.numero).padStart(8, '0') : ''
          }` },
        { key: 'fecha', label: 'Fecha', width: 14,
          value: (r) => r.fecha ? new Date(r.fecha) : null },
        { key: 'administracion_nombre', label: 'Administración', width: 28 },
        { key: 'receptor_razon_social', label: 'Receptor', width: 24,
          value: (r) => r.receptor_razon_social ?? '' },
        { key: 'total', label: 'Total', width: 14,
          value: (r) => Number(r.total ?? 0) },
        { key: 'saldo_pendiente', label: 'Saldo pendiente', width: 16,
          value: (r) => Number(r.saldo_pendiente ?? 0) },
        { key: 'estado_cobranza', label: 'Cobranza', width: 14,
          value: (r) => COBRANZA_BADGES[r.estado_cobranza as CobranzaEstado]?.label ?? r.estado_cobranza },
        { key: 'estado', label: 'Estado', width: 14,
          value: (r) => ESTADO_BADGES[r.estado as ComprobanteEstado]?.label ?? r.estado },
      ],
      rows,
    });
  }

  // P2-#16 · copia al portapapeles
  async function onCopyCsv() {
    return copyAsCsv(
      rows,
      [
        { key: 'fecha', label: 'Fecha', format: (r) => formatDate(r.fecha) },
        { key: 'tipo', label: 'Tipo' },
        { key: 'punto_venta', label: 'PV' },
        { key: 'numero', label: 'Número' },
        { key: 'receptor_razon_social', label: 'Cliente',
          format: (r) => r.receptor_razon_social ?? '' },
        { key: 'total', label: 'Total',
          format: (r) => Number(r.total ?? 0).toFixed(2) },
        { key: 'saldo_pendiente', label: 'Saldo',
          format: (r) => Number(r.saldo_pendiente ?? 0).toFixed(2) },
        { key: 'estado_cobranza', label: 'Cobranza',
          format: (r) => COBRANZA_BADGES[r.estado_cobranza as CobranzaEstado]?.label ?? r.estado_cobranza },
        { key: 'estado', label: 'Estado',
          format: (r) => ESTADO_BADGES[r.estado as ComprobanteEstado]?.label ?? r.estado },
      ],
      { separator: ';' },
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Facturación
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Comprobantes simples (tipo X) y fiscales A/B/C con CAE vía ARCA.
            Envío por email, cobranzas e imputación a cuenta corriente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            onCopyCsv={onCopyCsv}
            disabled={rows.length === 0}
            hint="Comprobantes"
          />
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus size={16} /> Nuevo comprobante
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Receipt}
          label="Emitidos"
          value={<AnimatedNumber value={kpis.emitidos} />}
          hint={`${total} en la vista`}
          tone="cyan"
          delay={0}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Total emitido"
          value={
            <span className="tabular">
              $<AnimatedNumber value={Math.round(kpis.totalEmitido)} />
            </span>
          }
          hint="autorizados"
          tone="teal"
          delay={60}
        />
        <KpiCard
          icon={CalendarDays}
          label="Pendiente cobro"
          value={
            <span className="tabular">
              $<AnimatedNumber value={Math.round(kpis.totalPendiente)} />
            </span>
          }
          hint="pendiente + parcial"
          tone="cyan"
          delay={120}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Vencido"
          value={
            <span className="tabular">
              $<AnimatedNumber value={Math.round(kpis.totalVencido)} />
            </span>
          }
          hint={kpis.totalVencido > 0 ? 'acción requerida' : 'todo al día'}
          tone={kpis.totalVencido > 0 ? 'amber' : 'cyan'}
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
              placeholder="Razón social, CUIT/DNI…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Periodo" className="sm:w-44">
          <Input
            type="month"
            value={periodo.slice(0, 7)}
            onChange={(e) =>
              setPeriodo(e.target.value ? `${e.target.value}-01` : '')
            }
          />
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
              <option value="autorizado">Autorizado</option>
              <option value="borrador">Borrador</option>
              <option value="anulado">Anulado</option>
            </Select>
          </div>
        </Field>
        <Field label="Cobranza" className="sm:w-44">
          <Select
            value={cobranza}
            onChange={(e) => setCobranza(e.target.value as CobranzaFilter)}
          >
            <option value="todos">Todas</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
            <option value="vencido">Vencido</option>
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
              title="Sin comprobantes en este periodo"
              description={
                <>
                  Emití el primero del periodo o ajustá los filtros para
                  encontrar uno existente.
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Emitir el primero
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    <th className="px-4 py-3">Comprobante</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Cobranza</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const estadoBadge =
                      ESTADO_BADGES[r.estado as ComprobanteEstado];
                    const cobranzaBadge =
                      COBRANZA_BADGES[r.estado_cobranza as CobranzaEstado];
                    return (
                      <tr
                        key={r.id}
                        className="group border-b border-slate-100 transition-colors hover:bg-brand-zebra/40 motion-safe:animate-fade-up"
                        style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
                      >
                        <td className="px-4 py-3">
                          <Link
                            to={`/gerencia/facturacion/${r.id}`}
                            className="flex items-center gap-3 font-medium text-brand-ink transition group-hover:text-brand-cyan"
                          >
                            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                              <FileText size={15} />
                            </span>
                            <span className="min-w-0">
                              <span className="block">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-brand-muted">
                                  {r.tipo}
                                </span>{' '}
                                <span className="tabular">
                                  {String(r.punto_venta).padStart(5, '0')}-
                                  {r.numero
                                    ? String(r.numero).padStart(8, '0')
                                    : '—'}
                                </span>
                              </span>
                              <span className="block truncate text-xs text-brand-muted">
                                {r.receptor_razon_social}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-brand-muted">
                          <Link
                            to={`/gerencia/clientes/${r.administracion_id}`}
                            className="hover:text-brand-cyan"
                          >
                            {r.administracion_nombre}
                          </Link>
                          {r.consorcio_nombre && (
                            <span className="block text-xs">
                              · {r.consorcio_nombre}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular text-brand-muted">
                          {formatDate(r.fecha)}
                          {r.vencimiento && (
                            <span className="block text-[11px]">
                              vence {formatDate(r.vencimiento)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular font-medium text-brand-ink">
                          {formatMoney(r.total)}
                          {Number(r.saldo_pendiente) > 0 &&
                            Number(r.saldo_pendiente) < Number(r.total) && (
                              <span className="block text-[11px] text-amber-700">
                                resta {formatMoney(r.saldo_pendiente)}
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-3">
                          {/* Si el comprobante está anulado, no mostramos el
                              estado de cobranza (sería redundante con el chip
                              "Anulado" rojo del estado). */}
                          {r.estado !== 'anulado' ? (
                            <span
                              className={cn(
                                'inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                cobranzaBadge?.cls ?? '',
                              )}
                            >
                              {cobranzaBadge?.label ?? r.estado_cobranza}
                            </span>
                          ) : (
                            <span className="text-brand-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              estadoBadge?.cls ?? '',
                            )}
                          >
                            {estadoBadge?.label ?? r.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/gerencia/facturacion/${r.id}`}
                            className="inline-flex text-brand-muted transition-transform group-hover:translate-x-1 group-hover:text-brand-cyan"
                            aria-label="Abrir comprobante"
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

      <ComprobanteFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
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
  icon: typeof Receipt;
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
        'group relative overflow-hidden rounded-2xl border bg-white p-4 transition motion-safe:animate-fade-up hover:-translate-y-0.5',
        ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={110}
        tone={tone === 'amber' ? 'cyan' : tone}
        density="soft"
        className="opacity-35"
      />
      <div className="relative flex items-start gap-3">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
            iconCls,
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-muted">{label}</p>
          <p className="mt-0.5 font-display text-xl font-bold leading-none text-brand-ink">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-brand-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function formatMoney(n: number | string | null): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function currentPeriodo(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
