import { TrendingUp, TrendingDown, Scale, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '@/components/common';
import { cn } from '@/lib/cn';
import {
  fmtMoneda,
  type PartnerRendicionRow,
} from '@/services/api/partners';

interface Props {
  rendicion: PartnerRendicionRow;
}

export function RendicionResumenCard({ rendicion }: Props) {
  const neto = Number(rendicion.neto ?? 0);
  const isPositive = neto >= 0;
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={TrendingUp}
        label="Ingresos atribuidos"
        value={fmtMoneda(rendicion.total_ingresos_atribuidos)}
        subValue={`bruto: ${fmtMoneda(rendicion.total_ingresos_brutos)}`}
        tone="cyan"
      />
      <StatCard
        icon={TrendingDown}
        label="Costos atribuidos"
        value={fmtMoneda(rendicion.total_costos_atribuidos)}
        subValue={`bruto: ${fmtMoneda(rendicion.total_costos_brutos)}`}
        tone="amber"
      />
      <StatCard
        icon={Scale}
        label="Neto a rendir"
        value={
          <>
            <AnimatedNumber value={neto} /> <span className="text-xs">ARS</span>
          </>
        }
        subValue={
          isPositive ? 'Gestión Global paga al partner' : 'Partner reembolsa a Gestión Global'
        }
        tone={isPositive ? 'emerald' : 'red'}
        emphasis
      />
    </section>
  );
}

interface StatProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  tone: 'cyan' | 'amber' | 'emerald' | 'red';
  emphasis?: boolean;
}

const TONE: Record<StatProps['tone'], string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
};

function StatCard({ icon: Icon, label, value, subValue, tone, emphasis }: StatProps) {
  return (
    <div
      className={cn(
        'card-premium flex flex-col gap-2 p-4',
        emphasis && 'ring-1 ring-brand-cyan/30',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('grid h-9 w-9 place-items-center rounded-lg', TONE[tone])}>
          <Icon size={16} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </p>
      </div>
      <p className="font-display text-2xl font-bold text-brand-ink">{value}</p>
      {subValue && (
        <p className="text-xs text-brand-muted">{subValue}</p>
      )}
    </div>
  );
}
