import { AlertCircle, CalendarClock, TrendingUp, Wallet } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { AnimatedNumber } from '@/components/common/AnimatedNumber';
import { cn } from '@/lib/cn';
import type { DashboardKpis } from '@/services/api/dashboard';

interface DashboardKpiStripProps {
  data: DashboardKpis | null;
  loading: boolean;
}

// Formato moneda ARS sin decimales para la home (densidad). Detalle fino vive
// en cada módulo (facturación, recupero, etc).
const fmtMoneda = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const fmtEntero = (n: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);

interface KpiCardProps {
  label: string;
  hint: string;
  value: number;
  format?: (n: number) => string;
  icon: typeof Wallet;
  tone: 'cyan' | 'emerald' | 'amber' | 'slate';
  delay: number;
  loading: boolean;
}

const TONE: Record<
  KpiCardProps['tone'],
  { ring: string; icon: string; iconBg: string; accent: 'cyan' | 'teal' }
> = {
  cyan: {
    ring: 'hover:border-brand-cyan/40',
    icon: 'text-brand-cyan',
    iconBg: 'bg-brand-cyan-pale/40',
    accent: 'cyan',
  },
  emerald: {
    ring: 'hover:border-emerald-300',
    icon: 'text-emerald-600',
    iconBg: 'bg-emerald-50',
    accent: 'teal',
  },
  amber: {
    ring: 'hover:border-amber-300',
    icon: 'text-amber-600',
    iconBg: 'bg-amber-50',
    accent: 'cyan',
  },
  slate: {
    ring: 'hover:border-slate-300',
    icon: 'text-slate-600',
    iconBg: 'bg-slate-100',
    accent: 'teal',
  },
};

function KpiCard({
  label,
  hint,
  value,
  format,
  icon: Icon,
  tone,
  delay,
  loading,
}: KpiCardProps) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition motion-safe:animate-fade-up',
        t.ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={140}
        tone={t.accent}
        density="soft"
        className="opacity-30 transition-opacity group-hover:opacity-60"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="kicker text-brand-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {loading ? (
              <span className="inline-block h-7 w-28 animate-pulse rounded bg-slate-100 align-middle" />
            ) : (
              <AnimatedNumber value={value} format={format} />
            )}
          </p>
          <p className="mt-1 text-xs text-brand-muted">{hint}</p>
        </div>
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            t.iconBg,
            t.icon,
          )}
        >
          <Icon size={18} />
        </span>
      </div>
    </div>
  );
}

// Strip de 4 KPI cards: facturado/cobrado/deuda/trámites. Premium UX:
// animación fade-up escalonada, AnimatedNumber con ease-out (estilo Stripe).
export function DashboardKpiStrip({ data, loading }: DashboardKpiStripProps) {
  return (
    <section>
      <p className="kicker mb-3 text-brand-muted">Resumen de los últimos 30 días</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Facturado 30d"
          hint="Comprobantes autorizados"
          value={data?.facturado_periodo ?? 0}
          format={fmtMoneda}
          icon={TrendingUp}
          tone="cyan"
          delay={0}
          loading={loading}
        />
        <KpiCard
          label="Cobrado 30d"
          hint="Ingresos imputados a comprobantes"
          value={data?.cobrado_periodo ?? 0}
          format={fmtMoneda}
          icon={Wallet}
          tone="emerald"
          delay={80}
          loading={loading}
        />
        <KpiCard
          label="Deuda total"
          hint={`${fmtEntero(data?.admins_morosos ?? 0)} administraciones con saldo`}
          value={data?.deuda_total ?? 0}
          format={fmtMoneda}
          icon={AlertCircle}
          tone="amber"
          delay={160}
          loading={loading}
        />
        <KpiCard
          label="Trámites abiertos"
          hint={`${fmtEntero(data?.vencimientos_proximos ?? 0)} vencimientos en 30d`}
          value={data?.tramites_abiertos ?? 0}
          format={fmtEntero}
          icon={CalendarClock}
          tone="slate"
          delay={240}
          loading={loading}
        />
      </div>
    </section>
  );
}
