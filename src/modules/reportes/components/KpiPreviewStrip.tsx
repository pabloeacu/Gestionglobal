import { AnimatedNumber } from '@/components/common';

// ============================================================================
// KpiPreviewStrip · vista previa de totales antes de exportar.
// ============================================================================

export interface KpiItem {
  label: string;
  value: number;
  format?: 'money' | 'number';
  accent?: 'cyan' | 'teal' | 'ink';
}

interface Props {
  items: KpiItem[];
  loading?: boolean;
}

export function KpiPreviewStrip({ items, loading }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((k) => {
        const accent =
          k.accent === 'teal'
            ? 'text-brand-teal'
            : k.accent === 'ink'
              ? 'text-brand-ink'
              : 'text-brand-cyan';
        return (
          <div
            key={k.label}
            className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <span className="absolute inset-y-0 left-0 w-1 bg-brand-cyan" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
              {k.label}
            </p>
            <p className={`mt-1 font-display text-2xl font-bold ${accent}`}>
              {loading ? (
                <span className="inline-block h-7 w-24 animate-pulse rounded bg-slate-100" />
              ) : k.format === 'money' ? (
                new Intl.NumberFormat('es-AR', {
                  style: 'currency', currency: 'ARS',
                  minimumFractionDigits: 0, maximumFractionDigits: 0,
                }).format(k.value)
              ) : (
                <AnimatedNumber value={k.value} />
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
