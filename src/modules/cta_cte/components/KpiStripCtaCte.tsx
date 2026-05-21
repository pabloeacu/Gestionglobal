import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/common';
import { cn } from '@/lib/cn';

export interface KpiItem {
  label: string;
  value: number;
  icon?: ReactNode;
  tone?: 'cyan' | 'amber' | 'emerald' | 'rose' | 'slate';
  hint?: string;
  prefix?: string;
}

interface Props {
  items: KpiItem[];
  className?: string;
}

const TONES: Record<NonNullable<KpiItem['tone']>, string> = {
  cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-700',
};

const VALUE_TONES: Record<NonNullable<KpiItem['tone']>, string> = {
  cyan: 'text-brand-cyan',
  amber: 'text-amber-700',
  emerald: 'text-emerald-700',
  rose: 'text-rose-700',
  slate: 'text-brand-ink',
};

// Strip de KPIs con AnimatedNumber. Reusable: gerencia (global) y detalle
// por administración. Premium UX (regla 13).
export function KpiStripCtaCte({ items, className }: Props) {
  return (
    <section
      className={cn(
        'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {items.map((it, i) => {
        const tone = it.tone ?? 'slate';
        return (
          <div
            key={it.label}
            className="card-premium relative overflow-hidden p-4 motion-safe:animate-fade-up"
            style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
          >
            <div className="flex items-center gap-3">
              {it.icon && (
                <span
                  className={cn(
                    'grid h-10 w-10 place-items-center rounded-xl',
                    TONES[tone],
                  )}
                >
                  {it.icon}
                </span>
              )}
              <div className="min-w-0">
                <p className="kicker text-brand-muted">{it.label}</p>
                <p
                  className={cn(
                    'mt-0.5 font-display text-xl font-bold tabular sm:text-2xl',
                    VALUE_TONES[tone],
                  )}
                >
                  {it.prefix ?? '$'}
                  <AnimatedNumber value={Math.round(it.value)} />
                </p>
                {it.hint && (
                  <p className="mt-0.5 truncate text-[11px] text-brand-muted">
                    {it.hint}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
