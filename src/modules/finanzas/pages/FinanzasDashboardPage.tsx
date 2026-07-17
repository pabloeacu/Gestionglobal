import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft, Plus, TrendingUp, TrendingDown, Wallet, AlertCircle,
  Banknote, Search, X, RotateCcw, Ban, Landmark, UserCheck, Undo2,
} from 'lucide-react';
import { Button, Input, Select, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import {
  getCajasConSaldo, getDashboardKpis, listarMovimientos,
  anularMovimiento, revertirMovimiento, desidentificarMovimiento,
  type CajaConSaldoRow, type DashboardKpis, type MovimientoListadoRow,
} from '@/services/api/finanzas';
import { cn } from '@/lib/cn';
import { NuevoMovimientoModal } from '../components/NuevoMovimientoModal';
import { IdentificarMovimientoModal } from '../components/IdentificarMovimientoModal';
import { TransferenciaModal } from '../components/TransferenciaModal';
import { TipoBadge, EstadoBadge, formatMonto, montoColor } from '../components/MovimientoBadges';
import { MovimientoAdjuntosButton } from '../components/MovimientoAdjuntosButton';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function fmtFecha(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  } catch { return d; }
}

export function FinanzasDashboardPage() {
  const confirm = useConfirm();
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);
  const [kpis, setKpis] = useState<DashboardKpis>({ saldo_total: 0, ingresos_mes: 0, egresos_mes: 0, movs_pendientes: 0, cajas_activas: 0 });
  const [movs, setMovs] = useState<MovimientoListadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroCaja, setFiltroCaja] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('');
  const [search, setSearch] = useState('');
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  // JL-W8-3 · movimiento pendiente elegido para identificar
  const [identificarTarget, setIdentificarTarget] = useState<MovimientoListadoRow | null>(null);

  async function recargar() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      getCajasConSaldo(),
      getDashboardKpis(),
      listarMovimientos({
        cajaId: filtroCaja || null,
        tipo: (filtroTipo as 'ingreso' | 'egreso' | null) || null,
        search: search || null,
        limit: 20,
      }),
    ]);
    setLoading(false);
    if (r1.ok) setCajas(r1.data);
    if (r2.ok) setKpis(r2.data);
    if (r3.ok) setMovs(r3.data.rows);
  }
  useEffect(() => { void recargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtroCaja, filtroTipo]);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { void recargar(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const balanceNeto = useMemo(() => kpis.ingresos_mes - kpis.egresos_mes, [kpis]);

  // DGG-26 · Export a PDF/XLS de los movimientos visibles.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (filtroCaja) {
      const caja = cajas.find((c) => c.caja_id === filtroCaja);
      items.push({ label: 'Caja', value: caja?.nombre ?? filtroCaja });
    }
    if (filtroTipo) {
      const label: Record<string, string> = {
        ingreso: 'Ingresos',
        egreso: 'Egresos',
        transferencia_in: 'Transferencia (entrada)',
        transferencia_out: 'Transferencia (salida)',
      };
      items.push({ label: 'Tipo', value: label[filtroTipo] ?? filtroTipo });
    }
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [filtroCaja, filtroTipo, search, cajas]);

  async function onExportPdf() {
    await generateReportPdf<MovimientoListadoRow>({
      filename: `movimientos-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Movimientos financieros',
      subtitulo: 'Caja & bancos · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'Saldo total', value: formatMoney(kpis.saldo_total), tone: 'cyan' },
        { label: 'Ingresos mes', value: formatMoney(kpis.ingresos_mes), tone: 'emerald' },
        { label: 'Egresos mes', value: formatMoney(kpis.egresos_mes), tone: 'rose' },
        { label: 'Balance neto', value: formatMoney(balanceNeto),
          tone: balanceNeto >= 0 ? 'emerald' : 'rose' },
      ],
      columns: [
        { key: 'fecha', label: 'Fecha', width: '12%',
          format: (r) => fmtFecha(r.fecha) },
        { key: 'caja_nombre', label: 'Caja', width: '18%' },
        { key: 'tipo', label: 'Tipo', width: '14%' },
        { key: 'categoria_nombre', label: 'Categoría', width: '18%',
          format: (r) => r.categoria_nombre ?? '—' },
        { key: 'monto', label: 'Monto', align: 'right', width: '14%',
          format: (r) => formatMoney(r.monto) },
        { key: 'descripcion', label: 'Descripción', width: '24%',
          format: (r) => r.descripcion ?? '—' },
      ],
      rows: movs,
    });
  }

  async function onExportXls() {
    generateReportXls<MovimientoListadoRow>({
      filename: `movimientos-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Movimientos',
      titulo: 'Movimientos · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'fecha', label: 'Fecha', width: 14,
          value: (r) => r.fecha ? new Date(r.fecha + 'T00:00:00') : null },
        { key: 'caja_nombre', label: 'Caja', width: 22 },
        { key: 'tipo', label: 'Tipo', width: 14 },
        { key: 'categoria_nombre', label: 'Categoría', width: 22,
          value: (r) => r.categoria_nombre ?? '' },
        { key: 'monto', label: 'Monto', width: 16,
          value: (r) => Number(r.monto ?? 0) },
        { key: 'descripcion', label: 'Descripción', width: 36,
          value: (r) => r.descripcion ?? '' },
        { key: 'administracion_nombre', label: 'Administración', width: 24,
          value: (r) => r.administracion_nombre ?? '' },
        { key: 'estado', label: 'Estado', width: 12 },
      ],
      rows: movs,
    });
  }

  async function onRevertir(m: MovimientoListadoRow) {
    if (m.origen === 'reversion') {
      toast.error('No se puede revertir un contrasiento');
      return;
    }
    const okConfirm = await confirm({
      title: 'Revertir movimiento',
      message: `Se va a crear un contrasiento por ${formatMoney(m.monto)}. Esta acción genera un movimiento nuevo (no borra el original) y no se puede deshacer.`,
      confirmLabel: 'Revertir',
      danger: true,
    });
    if (!okConfirm) return;
    const res = await revertirMovimiento(m.id);
    if (!res.ok) {
      toast.error('No pudimos revertir', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Movimiento revertido');
    void recargar();
  }

  async function onAnular(m: MovimientoListadoRow) {
    const okConfirm = await confirm({
      title: 'Anular movimiento',
      message: `Marca el movimiento como anulado. No impacta el saldo. Usar solo si NO tiene imputaciones a comprobantes.`,
      confirmLabel: 'Anular',
      danger: true,
    });
    if (!okConfirm) return;
    const res = await anularMovimiento(m.id);
    if (!res.ok) {
      toast.error('No pudimos anular', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Movimiento anulado');
    void recargar();
  }

  // JL-W8-3 · deshacer una identificación errónea ("reconocí al cliente
  // equivocado"). La RPC bloquea si tiene aplicaciones vivas a comprobantes.
  async function onDesidentificar(m: MovimientoListadoRow) {
    const okConfirm = await confirm({
      title: 'Deshacer identificación',
      message: (
        <div className="space-y-2 text-sm">
          <p>
            El movimiento vuelve a quedar <strong>sin identificar</strong>: se le quita el
            cliente ({m.administracion_nombre ?? '—'}) y deja de figurar en su cuenta corriente.
          </p>
          <p>El saldo de la caja no cambia. Si tiene pagos aplicados a comprobantes, primero quitá esas aplicaciones desde la cuenta corriente.</p>
        </div>
      ),
      confirmLabel: 'Deshacer',
      danger: true,
    });
    if (!okConfirm) return;
    const res = await desidentificarMovimiento(m.id);
    if (!res.ok) {
      toast.error('No pudimos deshacer la identificación', { description: humanizeError(res.error) });
      return;
    }
    toast.success('El movimiento volvió a "sin identificar"');
    void recargar();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Caja & bancos</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Finanzas
          </h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Saldos de cajas, movimientos y transferencias. Las cobranzas de comprobantes y pagos de cursos impactan automáticamente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            disabled={movs.length === 0}
            hint="Movimientos"
          />
          <Link
            to="/gerencia/finanzas/reportes"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:bg-slate-50"
          >
            <TrendingUp size={14} /> Reportes
          </Link>
          <Link
            to="/gerencia/finanzas/conciliacion"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:bg-slate-50"
          >
            <Landmark size={14} /> Conciliar
          </Link>
          <Link
            to="/gerencia/finanzas/importar"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:bg-slate-50"
          >
            <Banknote size={14} /> Importar histórico
          </Link>
          <Link
            to="/gerencia/finanzas/admin"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:bg-slate-50"
            title="Administrar cajas y categorías"
          >
            <Wallet size={14} /> Admin
          </Link>
          <Button variant="secondary" onClick={() => setTransferOpen(true)}>
            <ArrowRightLeft size={14} /> Transferir
          </Button>
          <Button onClick={() => setNuevoOpen(true)}>
            <Plus size={14} /> Nuevo movimiento
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Saldo total" value={formatMoney(kpis.saldo_total)} icon={Wallet} tone="navy" />
        <KpiCard label="Ingresos del mes" value={formatMoney(kpis.ingresos_mes)} icon={TrendingUp} tone="green" />
        <KpiCard label="Egresos del mes" value={formatMoney(kpis.egresos_mes)} icon={TrendingDown} tone="red" />
        <KpiCard
          label="Balance neto"
          value={formatMoney(balanceNeto)}
          icon={Banknote}
          tone={balanceNeto >= 0 ? 'cyan' : 'red'}
        />
      </div>

      {kpis.movs_pendientes > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>
            Hay <strong>{kpis.movs_pendientes}</strong> ingreso{kpis.movs_pendientes === 1 ? '' : 's'} en
            caja <strong>sin identificar</strong> — ya suman al saldo pero no figuran en la cuenta
            corriente de ningún cliente. Usá el botón <UserCheck size={12} className="-mt-0.5 inline" /> de
            la lista para reconocerlos.
          </span>
        </div>
      )}

      {/* Cajas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-muted">Cajas activas</h2>
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-brand-muted">
            Cargando…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cajas.filter((c) => c.activo).map((c) => {
              const isActive = filtroCaja === c.caja_id;
              return (
                <button
                  type="button"
                  key={c.caja_id}
                  onClick={() => setFiltroCaja(isActive ? '' : c.caja_id)}
                  title={isActive ? 'Quitar filtro' : 'Filtrar movimientos por esta caja'}
                  className={cn(
                    'group relative overflow-hidden rounded-2xl border bg-white p-5 text-left shadow-sm transition',
                    isActive
                      ? 'border-brand-cyan ring-2 ring-brand-cyan/40 shadow-md'
                      : 'border-slate-200 hover:border-brand-cyan/40 hover:shadow-md',
                  )}
                  style={{ borderLeft: `4px solid ${c.color ?? '#0891b2'}` }}
                >
                  <TrianglesAccent position="top-right" density="soft" className="opacity-30 group-hover:opacity-60" />
                  <p className="text-xs uppercase tracking-wider text-brand-muted">{c.tipo.replace('_', ' ')}</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-brand-ink">{c.nombre}</h3>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-brand-ink">
                    {formatMoney(c.saldo)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-muted">
                    {c.moneda}{c.movs_pendientes > 0 ? ` · ${c.movs_pendientes} pendientes` : ''}
                  </p>
                  {isActive && (
                    <span className="absolute right-3 top-3 rounded-full bg-brand-cyan px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      Filtrada
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Movimientos */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-muted">Movimientos recientes</h2>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                className="h-9 pl-7 w-48"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-ink">
                  <X size={12} />
                </button>
              )}
            </div>
            <Select value={filtroCaja} onChange={(e) => setFiltroCaja(e.target.value)} className="h-9 w-40">
              <option value="">Todas las cajas</option>
              {cajas.filter((c) => c.activo).map((c) => (
                <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>
              ))}
            </Select>
            <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="h-9 w-36">
              <option value="">Todos los tipos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
              <option value="transferencia_in">Transf. (in)</option>
              <option value="transferencia_out">Transf. (out)</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-brand-muted">
            Cargando…
          </div>
        ) : movs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-brand-muted">
            Sin movimientos con esos filtros.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Fecha</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Tipo</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Descripción</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Caja</th>
                  <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Monto</th>
                  <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movs.map((m) => (
                  <tr key={m.id} className={cn('hover:bg-slate-50', m.revertido_at && 'opacity-60', m.estado === 'anulado' && 'opacity-50')}>
                    <td className="px-4 py-2 text-xs text-brand-muted whitespace-nowrap">{fmtFecha(m.fecha)}</td>
                    <td className="px-4 py-2"><TipoBadge tipo={m.tipo} /></td>
                    <td className="px-4 py-2">
                      <div className="text-brand-ink">{m.descripcion ?? <span className="italic text-brand-muted">Sin descripción</span>}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {m.categoria_nombre && <span className="text-[10px] text-brand-muted">{m.categoria_nombre}</span>}
                        {m.administracion_nombre && <span className="text-[10px] text-brand-cyan">· {m.administracion_nombre}</span>}
                        <EstadoBadge estado={m.estado} revertido={!!m.revertido_at} />
                        {/* JL-W8-3 · historial: este ingreso entró sin identificar y fue reconocido */}
                        {m.identificado_at && m.estado === 'identificado' && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700"
                            title={`Identificado el ${new Date(m.identificado_at).toLocaleString('es-AR')}`}
                          >
                            <UserCheck size={9} /> Identificado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.caja_color ?? '#94a3b8' }} />
                        {m.caja_nombre}
                      </span>
                    </td>
                    <td className={cn('px-4 py-2 text-right font-mono tabular-nums font-semibold', montoColor(m.tipo))}>
                      {formatMonto(m.monto, m.tipo)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* JL-W8-3 · identificar un ingreso pendiente */}
                        {m.estado === 'pendiente_id' && !m.revertido_at && (
                          <button
                            type="button"
                            onClick={() => setIdentificarTarget(m)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                            title="Identificar: asignar el cliente y aplicar a su cuenta corriente"
                          >
                            <UserCheck size={12} /> Identificar
                          </button>
                        )}
                        {/* JL-W8-3 · deshacer una identificación errónea */}
                        {m.estado === 'identificado' && m.identificado_at && !m.revertido_at && (
                          <button
                            type="button"
                            onClick={() => void onDesidentificar(m)}
                            className="rounded-md p-1 text-amber-700 hover:bg-amber-50"
                            title="Deshacer identificación (vuelve a 'sin identificar')"
                          >
                            <Undo2 size={13} />
                          </button>
                        )}
                        {m.estado !== 'anulado' && (
                          <MovimientoAdjuntosButton movimientoId={m.id} initialCount={m.adjuntos_count} />
                        )}
                        {!m.revertido_at && m.estado !== 'anulado' && m.origen !== 'reversion' && (
                          <button
                            type="button"
                            onClick={() => onRevertir(m)}
                            className="rounded-md p-1 text-orange-600 hover:bg-orange-50"
                            title="Revertir (crea contrasiento)"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                        {/* E-GG-47 · Anular sólo permitido en movimientos
                            que NO entraron a un ciclo de reversión. El
                            contrasiento (origen='reversion') tampoco se
                            anula: dejaría huérfano al original del par y
                            descalibraría la caja. */}
                        {!m.revertido_at && m.estado !== 'anulado' && m.origen !== 'reversion' && (
                          <button
                            type="button"
                            onClick={() => onAnular(m)}
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                            title="Anular (no impacta saldo)"
                          >
                            <Ban size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {nuevoOpen && (
        <NuevoMovimientoModal
          cajas={cajas.filter((c) => c.activo)}
          onClose={() => setNuevoOpen(false)}
          onCreated={() => { setNuevoOpen(false); void recargar(); }}
        />
      )}
      {transferOpen && (
        <TransferenciaModal
          cajas={cajas.filter((c) => c.activo)}
          onClose={() => setTransferOpen(false)}
          onCreated={() => { setTransferOpen(false); void recargar(); }}
        />
      )}
      {/* JL-W8-3 · identificar ingreso pendiente */}
      {identificarTarget && (
        <IdentificarMovimientoModal
          movimiento={identificarTarget}
          onClose={() => setIdentificarTarget(null)}
          onIdentificado={() => { setIdentificarTarget(null); void recargar(); }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone: 'navy' | 'green' | 'red' | 'cyan' }) {
  const tones: Record<string, string> = {
    navy: 'bg-slate-50 text-slate-700 ring-slate-200',
    green: 'bg-green-50 text-green-700 ring-green-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-xl font-bold tabular-nums text-brand-ink">{value}</p>
    </div>
  );
}
