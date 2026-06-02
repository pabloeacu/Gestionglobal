import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Eye,
  FileDown,
  Search,
} from 'lucide-react';
import {
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import {
  getResumenGlobal,
  type ResumenGlobalRow,
} from '@/services/api/ctaCte';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import { KpiStripCtaCte } from '../components/KpiStripCtaCte';
import { formatMoney, defaultDesde, defaultHasta } from '../lib/format';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

type SortKey = 'deuda' | 'facturado' | 'cobrado' | 'nombre';
type SortDir = 'asc' | 'desc';

// Listado global de cuenta corriente (gerencia). Cita IDs: D09 (saldo
// derivado), regla 12 (assert_administracion_access en RPCs por admin),
// regla 13 (UX premium).
export function CtaCteListPage() {
  const [rows, setRows] = useState<ResumenGlobalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState<string>(defaultDesde());
  const [hasta, setHasta] = useState<string>(defaultHasta());
  const [search, setSearch] = useState('');
  const [estadoFilter, setEstadoFilter] =
    useState<'todos' | 'con_deuda' | 'con_vencidos' | 'al_dia'>('con_deuda');
  const [sortKey, setSortKey] = useState<SortKey>('deuda');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getResumenGlobal(desde || undefined, hasta || undefined);
    setLoading(false);
    if (!res.ok) {
      setError(humanizeError(res.error));
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  useRealtimeRefresh(
    ['comprobantes', 'movimientos', 'movimiento_imputaciones'],
    () => void load(),
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (s && !r.administracion_nombre.toLowerCase().includes(s))
          return false;
        if (estadoFilter === 'con_deuda' && r.deuda_total <= 0) return false;
        if (estadoFilter === 'con_vencidos' && r.comprobantes_vencidos === 0)
          return false;
        if (estadoFilter === 'al_dia' && r.deuda_total > 0) return false;
        return true;
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        switch (sortKey) {
          case 'nombre':
            return (
              dir *
              a.administracion_nombre.localeCompare(b.administracion_nombre)
            );
          case 'facturado':
            return dir * (a.total_facturado - b.total_facturado);
          case 'cobrado':
            return dir * (a.total_cobrado - b.total_cobrado);
          case 'deuda':
          default:
            return dir * (a.deuda_total - b.deuda_total);
        }
      });
  }, [rows, search, estadoFilter, sortKey, sortDir]);

  const kpis = useMemo(() => {
    const sum = (key: keyof ResumenGlobalRow) =>
      rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
    const vencidos = rows.reduce(
      (s, r) => s + (r.comprobantes_vencidos ?? 0),
      0,
    );
    return {
      facturado: sum('total_facturado'),
      cobrado: sum('total_cobrado'),
      pendiente: sum('deuda_total'),
      vencidos,
    };
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'nombre' ? 'asc' : 'desc');
    }
  }

  // DGG-26 · Export filtrado actual a PDF (branded) y XLS.
  const exportFiltros = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (desde) items.push({ label: 'Desde', value: desde });
    if (hasta) items.push({ label: 'Hasta', value: hasta });
    items.push({
      label: 'Estado',
      value:
        estadoFilter === 'todos' ? 'Todos'
        : estadoFilter === 'con_deuda' ? 'Con deuda'
        : estadoFilter === 'con_vencidos' ? 'Con vencidos'
        : 'Al día',
    });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [desde, hasta, estadoFilter, search]);

  const exportKpis = useMemo(
    () => [
      { label: 'Facturado', value: formatMoney(kpis.facturado), tone: 'cyan' as const },
      { label: 'Cobrado', value: formatMoney(kpis.cobrado), tone: 'emerald' as const },
      { label: 'Pendiente', value: formatMoney(kpis.pendiente), tone: 'amber' as const },
      { label: 'Vencidos', value: String(kpis.vencidos), tone: 'rose' as const },
    ],
    [kpis],
  );

  async function onExportPdf() {
    await generateReportPdf<ResumenGlobalRow>({
      filename: `cuenta-corriente-${desde}_${hasta}`,
      titulo: 'Cuenta corriente global',
      subtitulo: `Saldos consolidados por administración · ${desde} → ${hasta}`,
      filtros: exportFiltros,
      kpis: exportKpis,
      columns: [
        { key: 'administracion_nombre', label: 'Administración', width: '34%' },
        { key: 'total_facturado', label: 'Facturado', align: 'right', width: '16%',
          format: (r) => formatMoney(Number(r.total_facturado || 0)) },
        { key: 'total_cobrado', label: 'Cobrado', align: 'right', width: '16%',
          format: (r) => formatMoney(Number(r.total_cobrado || 0)) },
        { key: 'deuda_total', label: 'Deuda', align: 'right', width: '16%',
          format: (r) => formatMoney(Number(r.deuda_total || 0)) },
        { key: 'comprobantes_vencidos', label: 'Vencidos', align: 'right', width: '18%',
          format: (r) => String(r.comprobantes_vencidos ?? 0) },
      ],
      rows: filtered,
    });
  }

  async function onExportXls() {
    generateReportXls<ResumenGlobalRow>({
      filename: `cuenta-corriente-${desde}_${hasta}`,
      sheetName: 'Cuenta corriente',
      titulo: 'Cuenta corriente global · Gestión Global',
      subtitulo: `Período: ${desde} → ${hasta}`,
      filtros: exportFiltros,
      columns: [
        { key: 'administracion_nombre', label: 'Administración', width: 36 },
        { key: 'total_facturado', label: 'Facturado',
          value: (r) => Number(r.total_facturado || 0), width: 16 },
        { key: 'total_cobrado', label: 'Cobrado',
          value: (r) => Number(r.total_cobrado || 0), width: 16 },
        { key: 'deuda_total', label: 'Deuda',
          value: (r) => Number(r.deuda_total || 0), width: 16 },
        { key: 'comprobantes_vencidos', label: 'Comprobantes vencidos',
          value: (r) => Number(r.comprobantes_vencidos ?? 0), width: 20 },
      ],
      rows: filtered,
    });
  }

  if (loading && rows.length === 0) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando cuenta corriente" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Cuenta corriente</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Cuenta corriente global
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Saldos consolidados por administración para el período elegido.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            disabled={filtered.length === 0}
            hint="Cuenta corriente global"
          />
          <Link
            to="/gerencia/finanzas/importar"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan/40 hover:bg-brand-cyan/5"
            title="Subir movimientos históricos de cobranzas y deudas de tus clientes"
          >
            <FileDown size={16} /> Importar histórico
          </Link>
        </div>
      </header>

      <KpiStripCtaCte
        items={[
          {
            label: 'Facturado',
            value: kpis.facturado,
            icon: <TrendingUp size={18} />,
            tone: 'cyan',
            hint: 'Total emitido en el período',
          },
          {
            label: 'Cobrado',
            value: kpis.cobrado,
            icon: <TrendingDown size={18} />,
            tone: 'emerald',
            hint: 'Imputado en el período',
          },
          {
            label: 'Pendiente',
            value: kpis.pendiente,
            icon: <Wallet size={18} />,
            tone: 'amber',
            hint: `${rows.filter((r) => r.deuda_total > 0).length} admins con deuda`,
          },
          {
            label: 'Vencidos',
            value: kpis.vencidos,
            icon: <AlertCircle size={18} />,
            tone: 'rose',
            prefix: '',
            hint: 'Comprobantes vencidos sin pago',
          },
        ]}
      />

      {/* Filtros */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="Desde" className="flex-1 sm:max-w-[160px]">
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </Field>
        <Field label="Hasta" className="flex-1 sm:max-w-[160px]">
          <Input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </Field>
        <Field label="Estado" className="flex-1 sm:max-w-[200px]">
          <Select
            value={estadoFilter}
            onChange={(e) =>
              setEstadoFilter(e.target.value as typeof estadoFilter)
            }
          >
            <option value="todos">Todas</option>
            <option value="con_deuda">Con deuda</option>
            <option value="con_vencidos">Con vencidos</option>
            <option value="al_dia">Al día</option>
          </Select>
        </Field>
        <Field label="Buscar" className="flex-1">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Administración…"
              className="pl-8"
            />
          </div>
        </Field>
      </section>

      {/* Tabla */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          {error ? (
            <div className="p-8 text-center text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            rows.length === 0 ? (
              <IllustratedEmpty
                illustration="edificio"
                title="Aún no hay movimientos de cuenta corriente"
                description={
                  <>
                    Cuando emitas comprobantes o registres cobros, los saldos
                    consolidados por administración van a aparecer acá. También
                    podés importar el histórico desde Excel.
                  </>
                }
                action={
                  <Link
                    to="/gerencia/finanzas/importar"
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                  >
                    <FileDown size={16} /> Importar histórico
                  </Link>
                }
              />
            ) : (
              <IllustratedEmpty
                illustration="busqueda"
                title="Sin resultados para los filtros actuales"
                description="Ajustá el rango de fechas, el estado o la búsqueda para ver más administraciones."
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    <SortHeader
                      label="Administración"
                      k="nombre"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortHeader
                      label="Facturado"
                      k="facturado"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                      align="right"
                    />
                    <SortHeader
                      label="Cobrado"
                      k="cobrado"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                      align="right"
                    />
                    <SortHeader
                      label="Deuda"
                      k="deuda"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                      align="right"
                    />
                    <th className="px-4 py-2.5 text-center">Pendientes</th>
                    <th className="px-4 py-2.5 text-center">Vencidos</th>
                    <th className="px-4 py-2.5 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td colSpan={7} className="p-3">
                            <Skeleton className="h-8 w-full rounded" />
                          </td>
                        </tr>
                      ))
                    : filtered.map((r, idx) => (
                        <tr
                          key={r.administracion_id}
                          className="border-b border-slate-100 hover:bg-brand-zebra/30 motion-safe:animate-fade-up"
                          style={{
                            animationDelay: `${Math.min(idx, 10) * 22}ms`,
                          }}
                        >
                          <td className="px-4 py-3">
                            <Link
                              to={`/gerencia/cuenta-corriente/${r.administracion_id}`}
                              className="font-medium text-brand-ink transition hover:text-brand-cyan"
                            >
                              {r.administracion_nombre}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-right tabular">
                            {formatMoney(r.total_facturado, 0)}
                          </td>
                          <td className="px-4 py-3 text-right tabular text-emerald-700">
                            {formatMoney(r.total_cobrado, 0)}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-3 text-right tabular font-semibold',
                              r.deuda_total > 0
                                ? 'text-amber-700'
                                : 'text-brand-muted',
                            )}
                          >
                            {formatMoney(r.deuda_total, 0)}
                          </td>
                          <td className="px-4 py-3 text-center tabular text-xs text-brand-muted">
                            {r.comprobantes_pendientes}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {r.comprobantes_vencidos > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                <AlertCircle size={11} />
                                {r.comprobantes_vencidos}
                              </span>
                            ) : (
                              <span className="text-xs text-brand-muted">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              to={`/gerencia/cuenta-corriente/${r.administracion_id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
                            >
                              <Eye size={12} /> Ver
                            </Link>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = 'left',
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <th
      className={cn(
        'px-4 py-2.5 select-none',
        align === 'right' && 'text-right',
      )}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn(
          'inline-flex items-center gap-1 transition',
          active ? 'text-brand-cyan' : 'text-brand-muted hover:text-brand-ink',
        )}
      >
        {label}
        {active && (
          <span className="text-[10px]">
            {sortDir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
}
