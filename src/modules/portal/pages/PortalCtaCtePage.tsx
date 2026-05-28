import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ArrowDown, ArrowUp, Filter } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatedNumber, Field, Input } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  listCtaCteAdministracion,
  type CtaCteEntry,
} from '@/services/api/cobranzas';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Cuenta corriente del administrador en su portal. Mismo formato que el tab
// Cta. corriente de la ficha de administración (gerencia), pero sin
// navegación cruzada a comprobantes de gerencia: los links van al portal.

export function PortalCtaCtePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CtaCteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');

  async function load() {
    if (!user?.administracionId) return;
    setLoading(true);
    setError(null);
    // Portal cliente NO pasa admin_id: la RPC usa current_administracion_id().
    // Pasarlo dispara "solo staff puede consultar CC de otra admin".
    const res = await listCtaCteAdministracion();
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.administracionId]);

  useRealtimeRefresh(
    ['comprobantes', 'movimiento_imputaciones'],
    () => void load(),
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (desde && r.fecha < desde) return false;
      if (hasta && r.fecha > hasta) return false;
      return true;
    });
  }, [rows, desde, hasta]);

  const stats = useMemo(() => {
    const saldoActual = rows[0]?.saldo ?? 0;
    const totalCargos = filtered
      .filter((r) => r.signo === 1)
      .reduce((s, r) => s + r.monto, 0);
    const totalAbonos = filtered
      .filter((r) => r.signo === -1)
      .reduce((s, r) => s + r.monto, 0);
    return { saldoActual, totalCargos, totalAbonos };
  }, [filtered, rows]);

  if (!user?.administracionId) {
    return (
      <div className="mx-auto max-w-md p-12 text-center text-sm text-brand-muted">
        Tu cuenta no tiene una administración asociada.
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando cuenta corriente" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="kicker text-brand-cyan">Cuenta corriente</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Tu saldo
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Movimientos de cargos (comprobantes) y cobranzas, con el saldo
          acumulado al final de cada línea.
        </p>
      </header>

      {/* Hero: saldo total */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-fade-up">
        <TrianglesAccent
          position="top-right"
          size={220}
          tone="cyan"
          density="rich"
          className="opacity-30"
        />
        <TrianglesAccent
          position="bottom-left"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-25"
        />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="kicker text-brand-muted">Saldo actual</p>
            <p
              className={cn(
                'mt-1 font-display text-4xl font-bold tabular sm:text-5xl',
                stats.saldoActual > 0
                  ? 'text-amber-700'
                  : stats.saldoActual < 0
                    ? 'text-emerald-700'
                    : 'text-brand-ink',
              )}
            >
              $<AnimatedNumber value={Math.round(stats.saldoActual)} />
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              {stats.saldoActual > 0
                ? 'a favor de Gestión Global (saldo deudor)'
                : stats.saldoActual < 0
                  ? 'a tu favor (saldo acreedor)'
                  : 'cuenta saldada'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-cyan-pale/40 text-brand-cyan">
              <Wallet size={28} />
            </span>
          </div>
        </div>
      </section>

      {/* Stats secundarios */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Cargos"
          value={stats.totalCargos}
          icon={ArrowUp}
          tone="slate"
        />
        <StatCard
          label="Cobranzas"
          value={stats.totalAbonos}
          icon={ArrowDown}
          tone="emerald"
        />
        <StatCard
          label={`${filtered.length} movimientos`}
          value={null}
          icon={Filter}
          tone="cyan"
        />
      </section>

      {/* Filtros por período */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Desde" className="flex-1 sm:max-w-xs">
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </Field>
        <Field label="Hasta" className="flex-1 sm:max-w-xs">
          <Input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </Field>
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => {
              setDesde('');
              setHasta('');
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            Limpiar
          </button>
        )}
      </section>

      {/* Timeline */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          {error ? (
            <div className="p-8 text-center text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
                <Wallet size={20} />
              </span>
              <h3 className="font-display text-lg font-bold">
                Sin movimientos en este período
              </h3>
              <p className="max-w-sm text-sm text-brand-muted">
                Ajustá los filtros de fecha o esperá a que se carguen nuevos
                movimientos.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-4 py-2.5">Movimiento</th>
                    <th className="px-4 py-2.5 text-right">Cargo</th>
                    <th className="px-4 py-2.5 text-right">Cobranza</th>
                    <th className="px-4 py-2.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 hover:bg-brand-zebra/30 motion-safe:animate-fade-up"
                      style={{ animationDelay: `${Math.min(idx, 10) * 25}ms` }}
                    >
                      <td className="px-4 py-3 tabular text-xs text-brand-muted">
                        {formatDateShort(r.fecha)}
                      </td>
                      <td className="px-4 py-3">
                        {r.tipo === 'comprobante' && r.comprobante_id ? (
                          <Link
                            to={`/portal/comprobantes/${r.comprobante_id}`}
                            className="font-medium text-brand-ink hover:text-brand-cyan"
                          >
                            {r.titulo}
                          </Link>
                        ) : (
                          <span className="text-brand-ink">{r.titulo}</span>
                        )}
                        {r.consorcio_nombre && (
                          <span className="block text-xs text-brand-muted">
                            · {r.consorcio_nombre}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        {r.signo === 1 ? (
                          <span className="text-brand-ink">
                            {formatMoney(r.monto)}
                          </span>
                        ) : (
                          <span className="text-brand-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        {r.signo === -1 ? (
                          <span className="text-emerald-700">
                            {formatMoney(r.monto)}
                          </span>
                        ) : (
                          <span className="text-brand-muted">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-right tabular font-semibold',
                          r.saldo > 0
                            ? 'text-amber-700'
                            : r.saldo < 0
                              ? 'text-emerald-700'
                              : 'text-brand-muted',
                        )}
                      >
                        {formatMoney(r.saldo)}
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

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | null;
  icon: typeof Wallet;
  tone: 'slate' | 'emerald' | 'cyan';
}) {
  const cls =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'cyan'
        ? 'bg-brand-cyan-pale/40 text-brand-cyan'
        : 'bg-slate-100 text-slate-700';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', cls)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-muted">{label}</p>
          {value !== null && (
            <p className="mt-0.5 font-display text-lg font-bold tabular text-brand-ink">
              $<AnimatedNumber value={Math.round(value)} />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
