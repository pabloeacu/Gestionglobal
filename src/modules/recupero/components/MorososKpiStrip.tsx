import { Coins, Users, Send, AlertTriangle, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '@/components/common';
import { cn } from '@/lib/cn';
import { formatMoney } from '../lib/format';
import type { RecuperoKpis } from '@/services/api/recupero';

interface Props {
  kpis: RecuperoKpis;
  loading?: boolean;
}

const TONE: Record<'cyan' | 'amber' | 'red' | 'teal', string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  teal: 'bg-emerald-50 text-emerald-600',
};

interface CardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone: 'cyan' | 'amber' | 'red' | 'teal';
  loading?: boolean;
}

function KpiCard({ icon: Icon, label, value, tone, loading }: CardProps) {
  return (
    <div className="card-premium flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONE[tone])}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </p>
        <p className="font-display text-2xl font-bold text-brand-ink">
          {loading ? '…' : value}
        </p>
      </div>
    </div>
  );
}

export function MorososKpiStrip({ kpis, loading }: Props) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <KpiCard
        icon={Coins}
        label="Deuda total"
        tone="red"
        loading={loading}
        value={formatMoney(kpis.deuda_total)}
      />
      <KpiCard
        icon={Users}
        label="Morosos"
        tone="amber"
        loading={loading}
        value={<AnimatedNumber value={kpis.morosos_count} />}
      />
      <KpiCard
        icon={Send}
        label="R1 · 30 días"
        tone="cyan"
        loading={loading}
        value={<AnimatedNumber value={kpis.r1_30d} />}
      />
      <KpiCard
        icon={Send}
        label="R2 · 30 días"
        tone="amber"
        loading={loading}
        value={<AnimatedNumber value={kpis.r2_30d} />}
      />
      <KpiCard
        icon={AlertTriangle}
        label="R3 · 30 días"
        tone="red"
        loading={loading}
        value={<AnimatedNumber value={kpis.r3_30d} />}
      />
    </section>
  );
}
