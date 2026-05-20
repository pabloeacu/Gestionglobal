import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt,
  Wallet,
  CalendarClock,
  Building2,
  ArrowRight,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatedNumber } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { getAdministracion, type AdministracionRow } from '@/services/api/administraciones';
import { getPortalDashboard, type PortalDashboard } from '@/services/api/portal';
import {
  listCtaCteAdministracion,
  type CtaCteEntry,
} from '@/services/api/cobranzas';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort, parseLocalDate } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Dashboard del portal del administrador. Las queries usan administracion_id
// del profile actual; la RLS filtra automáticamente.

export function PortalHome() {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<AdministracionRow | null>(null);
  const [dash, setDash] = useState<PortalDashboard | null>(null);
  const [ctacte, setCtacte] = useState<CtaCteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user?.administracionId) return;
    setLoading(true);
    const [a, d, c] = await Promise.all([
      getAdministracion(user.administracionId),
      getPortalDashboard(user.administracionId),
      listCtaCteAdministracion(user.administracionId),
    ]);
    if (a.ok) setAdmin(a.data);
    if (d.ok) setDash(d.data);
    if (c.ok) setCtacte(c.data.slice(0, 5));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.administracionId]);

  useRealtimeRefresh(
    ['comprobantes', 'movimiento_imputaciones'],
    () => void load(),
  );

  if (!user?.administracionId) {
    return (
      <div className="mx-auto max-w-md p-12 text-center text-sm text-brand-muted">
        Tu cuenta no tiene una administración asociada. Contactá al staff.
      </div>
    );
  }

  if (loading && !dash) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando tu portal" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PortalCover admin={admin} userName={user.fullName ?? user.email} />

      <KpiStrip dash={dash} />

      <section className="grid gap-4 lg:grid-cols-3">
        <ProximosVencimientos dash={dash} />
        <UltimaActividad ctacte={ctacte} />
      </section>

      <QuickActions />
    </div>
  );
}

// ---------------- cover ----------------

function PortalCover({
  admin,
  userName,
}: {
  admin: AdministracionRow | null;
  userName: string;
}) {
  const initials = (admin?.nombre ?? userName ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm motion-safe:animate-fade-up">
      <div className="relative h-32 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal md:h-40">
        <TrianglesAccent
          position="top-right"
          size={240}
          tone="cyan"
          density="rich"
          className="opacity-60"
        />
        <TrianglesAccent
          position="bottom-left"
          size={170}
          tone="teal"
          density="soft"
          className="opacity-40"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.35),transparent_55%)]"
        />
      </div>
      <div className="relative px-6 pb-6 pt-0 sm:px-8">
        <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-brand-cyan to-brand-teal font-display text-3xl font-bold text-white shadow-lg sm:h-28 sm:w-28">
              {initials || <Building2 size={32} />}
            </span>
            <div className="min-w-0 pb-1">
              <p className="kicker text-brand-cyan">{greeting()}</p>
              <h1 className="break-words font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
                {admin?.nombre ?? 'Tu administración'}
              </h1>
              <p className="mt-1 text-sm text-brand-muted">
                Bienvenido/a, {userName.split(' ')[0]}. Acá vas a ver tus
                comprobantes, cuenta corriente y consorcios.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- KPIs ----------------

function KpiStrip({ dash }: { dash: PortalDashboard | null }) {
  const venceTone =
    !dash?.proximoVencimiento
      ? 'teal'
      : dash.proximoVencimiento.dias < 0
        ? 'amber'
        : dash.proximoVencimiento.dias <= 7
          ? 'amber'
          : 'teal';

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        icon={Receipt}
        label="Comprobantes activos"
        value={<AnimatedNumber value={dash?.comprobantesActivos ?? 0} />}
        hint="autorizados"
        tone="cyan"
        delay={0}
      />
      <KpiCard
        icon={Wallet}
        label="Saldo pendiente"
        value={
          <span className="tabular">
            $<AnimatedNumber value={Math.round(dash?.saldoPendienteTotal ?? 0)} />
          </span>
        }
        hint={
          (dash?.vencidosCount ?? 0) > 0
            ? `${dash?.vencidosCount} vencidos`
            : 'al día'
        }
        tone={(dash?.vencidosCount ?? 0) > 0 ? 'amber' : 'teal'}
        delay={60}
      />
      <KpiCard
        icon={CalendarClock}
        label="Próximo vencimiento"
        value={
          dash?.proximoVencimiento ? (
            dash.proximoVencimiento.dias < 0 ? (
              <span className="text-red-600">vencido</span>
            ) : dash.proximoVencimiento.dias === 0 ? (
              <span>hoy</span>
            ) : (
              <span>
                <AnimatedNumber value={dash.proximoVencimiento.dias} /> d
              </span>
            )
          ) : (
            <span className="text-brand-muted">—</span>
          )
        }
        hint={
          dash?.proximoVencimiento?.fecha
            ? formatDateShort(dash.proximoVencimiento.fecha)
            : 'sin vencimientos'
        }
        tone={venceTone}
        delay={120}
      />
      <KpiCard
        icon={Building2}
        label="Consorcios"
        value={<AnimatedNumber value={dash?.consorciosActivos ?? 0} />}
        hint="activos"
        tone="cyan"
        delay={180}
      />
    </section>
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
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', iconCls)}>
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

// ---------------- Próximos vencimientos ----------------

function ProximosVencimientos({ dash }: { dash: PortalDashboard | null }) {
  const items = dash?.proximosVencimientos ?? [];
  const today = new Date();

  return (
    <div className="card-premium relative overflow-hidden p-5 lg:col-span-2">
      <TrianglesAccent
        position="top-right"
        size={150}
        tone="cyan"
        density="soft"
        className="opacity-25"
      />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="kicker text-brand-cyan">Próximos vencimientos</p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-brand-ink">
              {items.length === 0
                ? 'Sin vencimientos próximos'
                : `${items.length} ${items.length === 1 ? 'comprobante' : 'comprobantes'} por vencer`}
            </h2>
          </div>
          <Link
            to="/portal/comprobantes"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline"
          >
            Ver todos <ArrowRight size={12} />
          </Link>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <CalendarClock size={20} />
            </span>
            <p className="text-sm text-brand-muted">
              Estás al día. No hay comprobantes pendientes que venzan en los
              próximos 30 días.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((c, idx) => {
              const dias = c.vencimiento
                ? Math.ceil(
                    (parseLocalDate(c.vencimiento).getTime() - today.getTime()) /
                      (1000 * 60 * 60 * 24),
                  )
                : null;
              const venceTone =
                dias === null
                  ? 'text-brand-muted'
                  : dias < 0
                    ? 'text-red-700 bg-red-50'
                    : dias <= 7
                      ? 'text-amber-700 bg-amber-50'
                      : 'text-brand-cyan bg-brand-cyan-pale/40';
              const numStr = c.numero
                ? `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`
                : '—';
              return (
                <li
                  key={c.id}
                  className="motion-safe:animate-fade-up"
                  style={{ animationDelay: `${Math.min(idx, 6) * 30}ms` }}
                >
                  <Link
                    to={`/portal/comprobantes/${c.id}`}
                    className="group flex items-center gap-3 py-3 transition hover:bg-brand-zebra/30"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
                      <FileText size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-brand-ink">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-brand-muted">
                          {c.tipo}
                        </span>{' '}
                        <span className="tabular">{numStr}</span>
                      </p>
                      <p className="truncate text-xs text-brand-muted">
                        {c.consorcio_nombre ?? c.receptor_razon_social}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium tabular text-brand-ink">
                        {formatMoney(Number(c.saldo_pendiente ?? c.total))}
                      </p>
                      <span
                        className={cn(
                          'mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          venceTone,
                        )}
                      >
                        {dias === null
                          ? '—'
                          : dias < 0
                            ? `vencido hace ${-dias}d`
                            : dias === 0
                              ? 'vence hoy'
                              : `en ${dias}d`}
                      </span>
                    </div>
                    <ChevronRight
                      size={14}
                      className="text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-cyan"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------- Última actividad ----------------

function UltimaActividad({ ctacte }: { ctacte: CtaCteEntry[] }) {
  return (
    <div className="card-premium relative overflow-hidden p-5">
      <TrianglesAccent
        position="bottom-left"
        size={130}
        tone="teal"
        density="soft"
        className="opacity-25"
      />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="kicker text-brand-cyan">Última actividad</p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-brand-ink">
              Movimientos
            </h2>
          </div>
          <Link
            to="/portal/cuenta-corriente"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline"
          >
            Ver todo <ArrowRight size={12} />
          </Link>
        </div>
        {ctacte.length === 0 ? (
          <div className="py-8 text-center text-sm text-brand-muted">
            Aún no hay movimientos.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {ctacte.map((r, idx) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 motion-safe:animate-fade-up"
                style={{ animationDelay: `${Math.min(idx, 6) * 30}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-brand-ink">{r.titulo}</p>
                  <p className="text-[11px] tabular text-brand-muted">
                    {formatDateShort(r.fecha)}
                  </p>
                </div>
                <span
                  className={cn(
                    'whitespace-nowrap text-sm font-medium tabular',
                    r.signo === 1 ? 'text-brand-ink' : 'text-emerald-700',
                  )}
                >
                  {r.signo === 1 ? '+' : '-'}
                  {formatMoney(r.monto)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------- Quick actions ----------------

function QuickActions() {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <QuickActionCard
        to="/portal/comprobantes"
        icon={Receipt}
        title="Ver mis comprobantes"
        description="Listado, filtros y descarga de PDF"
      />
      <QuickActionCard
        to="/portal/cuenta-corriente"
        icon={Wallet}
        title="Cuenta corriente"
        description="Cargos, cobranzas y saldo"
      />
      <QuickActionCard
        to="/portal/consorcios"
        icon={Building2}
        title="Mis consorcios"
        description="Edificios bajo administración"
      />
    </section>
  );
}

function QuickActionCard({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: typeof Receipt;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-md"
    >
      <TrianglesAccent
        position="top-right"
        size={100}
        tone="cyan"
        density="soft"
        className="opacity-20 transition group-hover:opacity-40"
      />
      <div className="relative flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
          <Icon size={18} />
        </span>
        <div className="flex-1">
          <p className="font-display text-sm font-bold text-brand-ink">{title}</p>
          <p className="mt-0.5 text-xs text-brand-muted">{description}</p>
        </div>
        <ArrowRight
          size={16}
          className="text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-cyan"
        />
      </div>
    </Link>
  );
}

// ---------------- helpers ----------------

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

