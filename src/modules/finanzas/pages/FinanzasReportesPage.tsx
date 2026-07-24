import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, TrendingUp, BarChart3, PieChart, GitCompareArrows,
  Download, ArrowUp, ArrowDown, Minus,
} from 'lucide-react';
import { Button, Field, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  getReporteFlujoCaja, getReporteBalanceMensual,
  getReportePyG, getReporteComparativo,
  type FlujoCajaRow, type BalanceMensualRow,
  type PygRow, type ComparativoRow,
} from '@/services/api/finanzas-admin';
import { humanizeError } from '@/lib/errors';
// E-GG-154: centavos en superíndice para los KPIs (cifras contables exactas).
import { MoneySup } from '../components/MoneySup';

function formatMoney(n: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && Math.abs(n) >= 1_000_000) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 1,
      notation: 'compact',
    }).format(n);
  }
  // E-GG-154: cifras contables exactas al centavo (el modo compact de los
  // ejes de gráficos sigue aproximando por diseño).
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

const ANIO_ACTUAL = new Date().getFullYear();

export function FinanzasReportesPage() {
  const [tab, setTab] = useState<'flujo' | 'balance' | 'pyg' | 'comparativo'>('flujo');
  const [anio, setAnio] = useState(ANIO_ACTUAL);

  const aniosOptions = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ANIO_ACTUAL - i);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/gerencia/finanzas"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-brand-ink/70 hover:bg-slate-100 hover:text-brand-ink"
        >
          <ArrowLeft size={16} /> Finanzas
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-ink">
            Reportes financieros
          </h1>
          <p className="text-sm text-brand-muted">
            Flujo de caja, balance, P&amp;L y comparativos.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          <ReportTab active={tab === 'flujo'} onClick={() => setTab('flujo')} icon={<TrendingUp size={15} />} label="Flujo de caja" />
          <ReportTab active={tab === 'balance'} onClick={() => setTab('balance')} icon={<BarChart3 size={15} />} label="Balance por caja" />
          <ReportTab active={tab === 'pyg'} onClick={() => setTab('pyg')} icon={<PieChart size={15} />} label="P&L por categoría" />
          <ReportTab active={tab === 'comparativo'} onClick={() => setTab('comparativo')} icon={<GitCompareArrows size={15} />} label="Año vs año" />
        </div>

        {tab !== 'pyg' && (
          <Select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="w-28"
          >
            {aniosOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        )}
      </div>

      {tab === 'flujo' && <FlujoCajaTab anio={anio} />}
      {tab === 'balance' && <BalanceTab anio={anio} />}
      {tab === 'pyg' && <PyGTab />}
      {tab === 'comparativo' && <ComparativoTab anio={anio} />}
    </div>
  );
}

function ReportTab({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition',
        active
          ? 'border-brand-cyan text-brand-ink'
          : 'border-transparent text-brand-muted hover:text-brand-ink',
      )}
    >
      {icon} {label}
    </button>
  );
}

// ====================================================================
// 1. Flujo de caja · gráfico de barras + tabla
// ====================================================================

function FlujoCajaTab({ anio }: { anio: number }) {
  const [data, setData] = useState<FlujoCajaRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await getReporteFlujoCaja(anio);
      setLoading(false);
      if (r.ok) setData(r.data);
      else toast.error(humanizeError(r.error));
    })();
  }, [anio]);

  const totales = useMemo(() => {
    return data.reduce(
      (acc, r) => ({
        ingresos: acc.ingresos + Number(r.ingresos),
        egresos: acc.egresos + Number(r.egresos),
      }),
      { ingresos: 0, egresos: 0 },
    );
  }, [data]);

  const maxValor = useMemo(() => {
    return Math.max(1, ...data.flatMap((r) => [Number(r.ingresos), Number(r.egresos)]));
  }, [data]);

  function exportCsv() {
    const rows = [
      ['Mes', 'Ingresos', 'Egresos', 'Neto', 'Saldo acumulado'],
      ...data.map((r) => [
        r.mes_label,
        String(r.ingresos),
        String(r.egresos),
        String(r.neto),
        String(r.saldo_acumulado),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `flujo-caja-${anio}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingCard />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Ingresos del año"
          value={totales.ingresos}
          tone="ingreso"
        />
        <KpiCard
          label="Egresos del año"
          value={totales.egresos}
          tone="egreso"
        />
        <KpiCard
          label="Neto del año"
          value={totales.ingresos - totales.egresos}
          tone={totales.ingresos - totales.egresos >= 0 ? 'neto-pos' : 'neto-neg'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-medium text-brand-ink">Movimiento mensual</h3>
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={14} /> CSV
          </Button>
        </div>

        {/* SVG bar chart */}
        <div className="relative h-72 overflow-x-auto">
          <svg viewBox="0 0 720 280" className="h-full w-full min-w-[640px]">
            {/* Grid */}
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <line
                key={p}
                x1={50} x2={700}
                y1={20 + p * 220} y2={20 + p * 220}
                stroke="#e2e8f0" strokeWidth={1}
              />
            ))}
            {/* Bars */}
            {data.map((r, i) => {
              const x = 60 + i * 55;
              const hIng = (Number(r.ingresos) / maxValor) * 220;
              const hEg = (Number(r.egresos) / maxValor) * 220;
              return (
                <g key={r.mes_num}>
                  <rect
                    x={x} y={240 - hIng}
                    width={20} height={hIng}
                    fill="#10b981" rx={3}
                  >
                    <title>{r.mes_label}: Ingresos {formatMoney(Number(r.ingresos))}</title>
                  </rect>
                  <rect
                    x={x + 22} y={240 - hEg}
                    width={20} height={hEg}
                    fill="#f43f5e" rx={3}
                  >
                    <title>{r.mes_label}: Egresos {formatMoney(Number(r.egresos))}</title>
                  </rect>
                  <text
                    x={x + 21} y={258}
                    textAnchor="middle" fontSize={11} fill="#64748b"
                  >
                    {r.mes_label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="mt-2 flex justify-center gap-6 text-xs text-brand-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-emerald-500" /> Ingresos</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-rose-500" /> Egresos</span>
        </div>
      </div>

      {/* E-GG-154: overflow-x-auto — con 2 decimales la tabla puede exceder en mobile */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-brand-muted">
              <th className="px-4 py-3 text-left">Mes</th>
              <th className="px-4 py-3 text-right">Ingresos</th>
              <th className="px-4 py-3 text-right">Egresos</th>
              <th className="px-4 py-3 text-right">Neto</th>
              <th className="px-4 py-3 text-right">Saldo acumulado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((r) => (
              <tr key={r.mes_num}>
                <td className="px-4 py-2.5 font-medium text-brand-ink">{r.mes_label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                  {Number(r.ingresos) > 0 ? formatMoney(Number(r.ingresos)) : '–'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">
                  {Number(r.egresos) > 0 ? formatMoney(Number(r.egresos)) : '–'}
                </td>
                <td className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-medium',
                  Number(r.neto) > 0 ? 'text-emerald-700' : Number(r.neto) < 0 ? 'text-rose-700' : 'text-brand-muted',
                )}>
                  {Number(r.neto) !== 0 ? formatMoney(Number(r.neto)) : '–'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-brand-ink">
                  {formatMoney(Number(r.saldo_acumulado))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====================================================================
// 2. Balance por caja
// ====================================================================

function BalanceTab({ anio }: { anio: number }) {
  const [data, setData] = useState<BalanceMensualRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await getReporteBalanceMensual(anio, true);
      setLoading(false);
      if (r.ok) setData(r.data);
      else toast.error(humanizeError(r.error));
    })();
  }, [anio]);

  // Group by caja
  const porCaja = useMemo(() => {
    const map = new Map<string, { caja: { id: string; nombre: string; color: string | null }; meses: BalanceMensualRow[] }>();
    for (const r of data) {
      if (!map.has(r.caja_id)) {
        map.set(r.caja_id, {
          caja: { id: r.caja_id, nombre: r.caja_nombre, color: r.caja_color },
          meses: [],
        });
      }
      map.get(r.caja_id)!.meses.push(r);
    }
    return Array.from(map.values());
  }, [data]);

  if (loading) return <LoadingCard />;

  return (
    <div className="space-y-5">
      {porCaja.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-brand-muted">
          Sin cajas activas.
        </div>
      )}

      {porCaja.map(({ caja, meses }) => {
        const finAnio = meses[11]?.saldo_final ?? 0;
        return (
          <div key={caja.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: caja.color ?? '#0e9bc8' }}
                />
                <h3 className="font-medium text-brand-ink">{caja.nombre}</h3>
              </div>
              <div className="text-right">
                <p className="text-xs text-brand-muted">Saldo al cierre</p>
                <p className={cn(
                  'font-bold tabular-nums',
                  Number(finAnio) >= 0 ? 'text-emerald-700' : 'text-rose-700',
                )}>
                  {formatMoney(Number(finAnio))}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-brand-muted">
                    <th className="px-4 py-2 text-left">Mes</th>
                    <th className="px-4 py-2 text-right">Saldo inicial</th>
                    <th className="px-4 py-2 text-right">Ingresos</th>
                    <th className="px-4 py-2 text-right">Egresos</th>
                    <th className="px-4 py-2 text-right">Saldo final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {meses.map((r) => (
                    <tr key={r.mes_num}>
                      <td className="px-4 py-2 font-medium text-brand-ink">{r.mes_label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-brand-muted">
                        {formatMoney(Number(r.saldo_inicial))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                        {Number(r.ingresos) > 0 ? formatMoney(Number(r.ingresos)) : '–'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                        {Number(r.egresos) > 0 ? formatMoney(Number(r.egresos)) : '–'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-ink">
                        {formatMoney(Number(r.saldo_final))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// 3. P&L por categoría
// ====================================================================

function PyGTab() {
  const [data, setData] = useState<PygRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState(`${ANIO_ACTUAL}-01-01`);
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await getReportePyG(desde, hasta);
      setLoading(false);
      if (r.ok) setData(r.data);
      else toast.error(humanizeError(r.error));
    })();
  }, [desde, hasta]);

  const ingresos = useMemo(() => data.filter((r) => r.tipo_movimiento === 'ingreso'), [data]);
  const egresos = useMemo(() => data.filter((r) => r.tipo_movimiento === 'egreso'), [data]);
  const totalIngresos = useMemo(() => ingresos.reduce((s, r) => s + Number(r.total), 0), [ingresos]);
  const totalEgresos = useMemo(() => egresos.reduce((s, r) => s + Number(r.total), 0), [egresos]);
  const resultado = totalIngresos - totalEgresos;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <Field label="Desde" className="min-w-[140px]">
          <input
            type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Hasta" className="min-w-[140px]">
          <input
            type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      {loading ? <LoadingCard /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard label="Total ingresos" value={totalIngresos} tone="ingreso" />
            <KpiCard label="Total egresos" value={totalEgresos} tone="egreso" />
            <KpiCard
              label="Resultado del período"
              value={resultado}
              tone={resultado >= 0 ? 'neto-pos' : 'neto-neg'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CategoriaList titulo="Ingresos" rows={ingresos} total={totalIngresos} tone="ingreso" />
            <CategoriaList titulo="Egresos" rows={egresos} total={totalEgresos} tone="egreso" />
          </div>
        </>
      )}
    </div>
  );
}

function CategoriaList({
  titulo, rows, total, tone,
}: { titulo: string; rows: PygRow[]; total: number; tone: 'ingreso' | 'egreso' }) {
  const baseColor = tone === 'ingreso' ? 'bg-emerald-500' : 'bg-rose-500';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-brand-ink">{titulo}</h3>
        <p className={cn('text-sm font-bold tabular-nums', tone === 'ingreso' ? 'text-emerald-700' : 'text-rose-700')}>
          {formatMoney(total)}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-brand-muted">Sin movimientos.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const pct = total > 0 ? (Number(r.total) / total) * 100 : 0;
            return (
              <div key={(r.categoria_id ?? 'null') + r.tipo_movimiento}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.categoria_color ?? '#94a3b8' }}
                    />
                    <span className="truncate text-sm text-brand-ink">
                      {r.categoria_nombre ?? '(Sin categoría)'}
                    </span>
                    <span className="text-xs text-brand-muted">· {r.cantidad_movimientos}</span>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <span className="text-sm font-medium text-brand-ink">{formatMoney(Number(r.total))}</span>
                    <span className="ml-2 text-xs text-brand-muted">{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full transition-all', baseColor)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// 4. Comparativo año vs año
// ====================================================================

function ComparativoTab({ anio }: { anio: number }) {
  const [data, setData] = useState<ComparativoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await getReporteComparativo(anio);
      setLoading(false);
      if (r.ok) setData(r.data);
      else toast.error(humanizeError(r.error));
    })();
  }, [anio]);

  if (loading) return <LoadingCard />;

  const totales = data.reduce(
    (acc, r) => ({
      iAct: acc.iAct + Number(r.ingresos_actual),
      iPrev: acc.iPrev + Number(r.ingresos_anterior),
      eAct: acc.eAct + Number(r.egresos_actual),
      ePrev: acc.ePrev + Number(r.egresos_anterior),
    }),
    { iAct: 0, iPrev: 0, eAct: 0, ePrev: 0 },
  );
  const varIng = totales.iPrev > 0 ? ((totales.iAct - totales.iPrev) / totales.iPrev) * 100 : null;
  const varEg = totales.ePrev > 0 ? ((totales.eAct - totales.ePrev) / totales.ePrev) * 100 : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <ComparativoKpi
          label="Ingresos"
          actual={totales.iAct}
          anterior={totales.iPrev}
          varPct={varIng}
          tone="ingreso"
        />
        <ComparativoKpi
          label="Egresos"
          actual={totales.eAct}
          anterior={totales.ePrev}
          varPct={varEg}
          tone="egreso"
        />
      </div>

      {/* E-GG-154: overflow-x-auto — con 2 decimales la tabla puede exceder en mobile */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-brand-muted">
              <th className="px-3 py-2.5 text-left" rowSpan={2}>Mes</th>
              <th colSpan={3} className="border-l border-slate-200 px-3 py-1 text-center">Ingresos</th>
              <th colSpan={3} className="border-l border-slate-200 px-3 py-1 text-center">Egresos</th>
              <th colSpan={2} className="border-l border-slate-200 px-3 py-1 text-center">Neto</th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-brand-muted">
              <th className="border-l border-slate-200 px-3 py-1 text-right">{anio}</th>
              <th className="px-3 py-1 text-right">{anio - 1}</th>
              <th className="px-3 py-1 text-right">Var.</th>
              <th className="border-l border-slate-200 px-3 py-1 text-right">{anio}</th>
              <th className="px-3 py-1 text-right">{anio - 1}</th>
              <th className="px-3 py-1 text-right">Var.</th>
              <th className="border-l border-slate-200 px-3 py-1 text-right">{anio}</th>
              <th className="px-3 py-1 text-right">{anio - 1}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((r) => (
              <tr key={r.mes_num}>
                <td className="px-3 py-2 font-medium text-brand-ink">{r.mes_label}</td>
                <td className="border-l border-slate-100 px-3 py-2 text-right tabular-nums text-emerald-700">
                  {formatMoney(Number(r.ingresos_actual), { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-muted">
                  {formatMoney(Number(r.ingresos_anterior), { compact: true })}
                </td>
                <td className="px-3 py-2 text-right">
                  <VariacionPct value={r.ingresos_var_pct} />
                </td>
                <td className="border-l border-slate-100 px-3 py-2 text-right tabular-nums text-rose-700">
                  {formatMoney(Number(r.egresos_actual), { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-muted">
                  {formatMoney(Number(r.egresos_anterior), { compact: true })}
                </td>
                <td className="px-3 py-2 text-right">
                  <VariacionPct value={r.egresos_var_pct} invert />
                </td>
                <td className={cn(
                  'border-l border-slate-100 px-3 py-2 text-right tabular-nums font-medium',
                  Number(r.neto_actual) >= 0 ? 'text-emerald-700' : 'text-rose-700',
                )}>
                  {formatMoney(Number(r.neto_actual), { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-muted">
                  {formatMoney(Number(r.neto_anterior), { compact: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparativoKpi({
  label, actual, anterior, varPct, tone,
}: {
  label: string; actual: number; anterior: number; varPct: number | null;
  tone: 'ingreso' | 'egreso';
}) {
  const color = tone === 'ingreso' ? 'text-emerald-700' : 'text-rose-700';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', color)}><MoneySup value={actual} /></p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-brand-muted">Año anterior: {formatMoney(anterior)}</span>
        <VariacionPct value={varPct} invert={tone === 'egreso'} />
      </div>
    </div>
  );
}

function VariacionPct({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-brand-muted">—</span>;
  const isPos = value > 0;
  const isPositive = invert ? !isPos : isPos;
  if (Math.abs(value) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-brand-muted">
        <Minus size={11} /> {value.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-xs font-medium',
      isPositive ? 'text-emerald-700' : 'text-rose-700',
    )}>
      {isPos ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {isPos ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

// ====================================================================
// Helpers
// ====================================================================

function LoadingCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-brand-muted">
      Cargando reporte…
    </div>
  );
}

function KpiCard({
  label, value, tone,
}: {
  label: string; value: number;
  tone: 'ingreso' | 'egreso' | 'neto-pos' | 'neto-neg';
}) {
  const styles = {
    'ingreso': 'border-emerald-200 bg-emerald-50',
    'egreso': 'border-rose-200 bg-rose-50',
    'neto-pos': 'border-emerald-200 bg-emerald-50',
    'neto-neg': 'border-rose-200 bg-rose-50',
  }[tone];
  const textColor = {
    'ingreso': 'text-emerald-700',
    'egreso': 'text-rose-700',
    'neto-pos': 'text-emerald-700',
    'neto-neg': 'text-rose-700',
  }[tone];
  return (
    <div className={cn('rounded-2xl border p-4', styles)}>
      <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', textColor)}>
        <MoneySup value={value} />
      </p>
    </div>
  );
}
